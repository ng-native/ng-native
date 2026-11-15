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
    std::thread thread;
    std::shared_ptr<std::atomic<bool>> finished;
    Then then;
    std::optional<Run> dropped;
    {
      std::lock_guard lock(state->mutex);
      state->closed = true;
      dropped = std::move(state->waiting);
      state->waiting.reset();
      if (state->thread.joinable() && state->thread.get_id() != std::this_thread::get_id()) {
        thread = std::move(state->thread);
        finished = state->finished;
        then = std::move(state->then);
        state->then = nullptr;
        state->joiner = std::this_thread::get_id();
      }
    }
    if (thread.joinable()) {
      while (!*finished) {
        service();
        std::this_thread::yield();
      }
      thread.join();
      if (then) {
        then(true);
      }
      std::lock_guard lock(state->mutex);
      state->joiner = std::thread::id();
    }
    if (dropped && dropped->then) {
      dropped->then(false);
    }
    // A `then` the UI queue is running on another thread, or a run another close is still joining
    // (this close not called from either).
    while (true) {
      {
        std::lock_guard lock(state->mutex);
        auto self = std::this_thread::get_id();
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
    // The thread whose close is joining the run and running its `then`, if one is.
    std::thread::id joiner;
  };

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
