// The thread a runtime reloads on, apart from the runtime so nothing a run leaves behind touches it.
// One run at a time, on a worker that is always joined and never detached. A run's `then` runs on
// the UI queue once its worker has been joined, never on the worker, so a `then` that starts the
// next run or destroys the owner never has to join the thread it is on. A run asked for while one
// is live waits its turn and starts from the UI queue after that run's `then`. Once closed, it
// starts no run, and close returns only once the live run has been joined and its `then` has run:
// nothing reaches the owner after its close. Toolkit-free.
#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <thread>

namespace ngn {

class ReloadThread {
 public:
  // Posts a task to the UI queue: the thread the owner lives on, which the run can need.
  using Post = std::function<void(std::function<void()>)>;
  // A run's last step, with whether its work ran: false when the run was refused or dropped.
  using Then = std::function<void(bool ran)>;

  explicit ReloadThread(Post post) : state_(std::make_shared<State>(std::move(post))) {}
  ReloadThread(const ReloadThread &) = delete;
  ReloadThread &operator=(const ReloadThread &) = delete;
  ~ReloadThread() {
    close([] {});
  }

  // Runs `work` on a worker thread, then `then(true)` on the UI queue once the worker has been
  // joined. With a run live (or its `then` still to come), the run waits its turn: it starts from
  // the UI queue after that one. Refused once closed, or with a run already waiting: `then(false)`
  // on the calling thread, and false. Any thread, the worker's own included.
  bool start(std::function<void()> work, Then then) {
    {
      std::lock_guard lock(state_->mutex);
      if (!state_->closed) {
        if (!state_->busy) {
          spawn(state_, {std::move(work), std::move(then)});
          return true;
        }
        if (!state_->waiting) {
          state_->waiting = Run{std::move(work), std::move(then)};
          return true;
        }
      }
    }
    if (then) {
      then(false);
    }
    return false;
  }

  // Starts no run from now on, and drops a waiting one (its `then(false)`). Waits for the live run,
  // calling `service` until it ends (the UI thread's queue, which the run can need), joins it and
  // runs its `then(true)` here if the UI queue has not yet. A `then` running on another thread is
  // waited for too. From the live run's own work, it cannot join: the run's `then` joins it.
  void close(const std::function<void()> &service) {
    // A then run below can destroy this owner, so only this local reference to the state is used.
    auto state = state_;
    auto self = std::this_thread::get_id();
    std::thread thread;
    std::shared_ptr<std::atomic<bool>> finished;
    {
      std::unique_lock lock(state->mutex);
      if (state->joiner == self) {
        // Reentered on the thread a close is already ending the run on. From a callback that close
        // runs there is nothing to wait for. From the UI queue it serves while it waits, this
        // close waits for the run too, and runs the callbacks still owed before it returns, so
        // they come before anything its caller tears down.
        if (state->joinerInCallback) {
          return;
        }
        auto ending = state->joining;
        lock.unlock();
        while (ending && !*ending) {
          service();
          std::this_thread::yield();
        }
        runEnding(state);
        return;
      }
      state->closed = true;
      if (state->joiner == std::thread::id()) {
        if (state->waiting) {
          state->endingDropped = std::move(state->waiting);
          state->waiting.reset();
        }
        if (state->thread.joinable() && state->thread.get_id() != self) {
          thread = std::move(state->thread);
          finished = state->finished;
          state->endingThen = std::move(state->then);
          state->then = nullptr;
        }
        // Until its callbacks have run, this close is the one ending the run: another close waits.
        if (thread.joinable() || state->endingDropped) {
          state->joiner = self;
          state->joining = finished;
        }
      }
    }
    if (thread.joinable()) {
      while (!*finished) {
        service();
        std::this_thread::yield();
      }
      thread.join();
    }
    runEnding(state);
    {
      std::lock_guard lock(state->mutex);
      if (state->joiner == self) {
        state->joiner = std::thread::id();
        state->joining = nullptr;
      }
    }
    // A `then` the UI queue is running on another thread, or a run another close is still ending
    // (this close not called from either).
    while (true) {
      {
        std::lock_guard lock(state->mutex);
        bool thenDone = state->thenThread == std::thread::id() || state->thenThread == self;
        bool joinDone = state->joiner == std::thread::id() || state->joiner == self;
        if (thenDone && joinDone) {
          break;
        }
      }
      service();
      std::this_thread::yield();
    }
  }

 private:
  struct Run {
    std::function<void()> work;
    Then then;
  };
  // Shared with the worker and the tasks it posts, so neither touches the owner.
  struct State {
    explicit State(Post post) : post(std::move(post)) {}
    std::mutex mutex;
    Post post;
    std::thread thread;
    std::shared_ptr<std::atomic<bool>> finished;
    Then then;
    // A run is live, or its `then` is still to run: a new run waits its turn.
    bool busy{false};
    std::optional<Run> waiting;
    bool closed{false};
    // The thread running a `then` from the UI queue, if one is.
    std::thread::id thenThread;
    // The thread whose close is ending the run (joining it, then running its and a dropped run's
    // callbacks), if one is; the run it waits on; and whether it is inside one of those callbacks.
    std::thread::id joiner;
    std::shared_ptr<std::atomic<bool>> joining;
    bool joinerInCallback{false};
    // The callbacks the closing run still owes: the joined run's `then` and a dropped run's. Kept
    // here so a close reentered from the UI queue can run them as well as the close that took them.
    Then endingThen;
    std::optional<Run> endingDropped;
  };

  // Runs the callbacks a close owes, the joined run's first, each once, whichever close gets to it.
  static void runEnding(const std::shared_ptr<State> &state) {
    while (true) {
      Then then;
      std::optional<Run> dropped;
      {
        std::lock_guard lock(state->mutex);
        if (state->endingThen) {
          then = std::move(state->endingThen);
          state->endingThen = nullptr;
        } else if (state->endingDropped) {
          dropped = std::move(state->endingDropped);
          state->endingDropped.reset();
        } else {
          return;
        }
        state->joinerInCallback = true;
      }
      if (then) {
        then(true);
      } else if (dropped->then) {
        dropped->then(false);
      }
      std::lock_guard lock(state->mutex);
      state->joinerInCallback = false;
    }
  }

  // Under the state's lock.
  static void spawn(const std::shared_ptr<State> &state, Run run) {
    auto finished = std::make_shared<std::atomic<bool>>(false);
    state->busy = true;
    state->finished = finished;
    state->then = std::move(run.then);
    state->thread = std::thread([state, work = std::move(run.work), finished] {
      work();
      *finished = true;
      // The worker's last step: everything after it (the join, `then`, the next run) is the UI
      // queue's.
      state->post([state] { finish(state); });
    });
  }

  // On the UI queue, once a run's work is done.
  static void finish(const std::shared_ptr<State> &state) {
    std::thread thread;
    Then then;
    {
      std::lock_guard lock(state->mutex);
      // A close may have joined the run and taken its `then` already.
      thread = std::move(state->thread);
      then = std::move(state->then);
      state->then = nullptr;
      state->thenThread = std::this_thread::get_id();
    }
    if (thread.joinable()) {
      thread.join();
    }
    if (then) {
      then(true);
    }
    std::optional<Run> dropped;
    {
      std::lock_guard lock(state->mutex);
      state->thenThread = std::thread::id();
      state->busy = false;
      if (state->waiting) {
        Run next = std::move(*state->waiting);
        state->waiting.reset();
        if (state->closed) {
          dropped = std::move(next);
        } else {
          spawn(state, std::move(next));
        }
      }
    }
    if (dropped && dropped->then) {
      dropped->then(false);
    }
  }

  std::shared_ptr<State> state_;
};

} // namespace ngn
