#include "ngn/reload-thread.h"

#include <doctest/doctest.h>

#include <chrono>
#include <deque>
#include <memory>
#include <mutex>

namespace {

// A UI thread's queue, served only when the waiting side calls `serve`.
struct UiQueue {
  std::mutex mutex;
  std::deque<std::function<void()>> tasks;
  void post(std::function<void()> task) {
    std::lock_guard lock(mutex);
    tasks.push_back(std::move(task));
  }
  void serve() {
    std::deque<std::function<void()>> now;
    {
      std::lock_guard lock(mutex);
      now.swap(tasks);
    }
    for (auto &task : now) {
      task();
    }
  }
  // From the run's thread: posts to the UI queue and waits, up to a while, for it to run.
  bool roundTrip() {
    auto ran = std::make_shared<std::atomic<bool>>(false);
    post([ran] { *ran = true; });
    auto until = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (!*ran && std::chrono::steady_clock::now() < until) {
      std::this_thread::yield();
    }
    return *ran;
  }
};

void waitFor(const std::atomic<bool> &flag) {
  while (!flag) {
    std::this_thread::yield();
  }
}

} // namespace

TEST_CASE("a join serves the UI queue until the run that needs it ends") {
  UiQueue ui;
  ngn::ReloadThread reload;
  std::atomic<bool> served{false};
  reload.start([&] { served = ui.roundTrip(); });
  reload.join([&] { ui.serve(); });
  CHECK(served);
}

TEST_CASE("a run that starts the next from its done leaves a later join waiting on the next run") {
  UiQueue ui;
  ngn::ReloadThread reload;
  std::atomic<bool> second{false};
  std::atomic<bool> firstReturning{false};
  std::atomic<bool> servedSecond{false};
  reload.start([&] {
    // `done` reloads: the join from the run's own thread returns at once.
    reload.join([] {});
    reload.start([&] {
      second = true;
      servedSecond = ui.roundTrip();
    });
    firstReturning = true;
  });
  waitFor(firstReturning);
  waitFor(second);
  // The first run has ended by now, marking only its own state done.
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  reload.join([&] { ui.serve(); });
  CHECK(servedSecond);
}

TEST_CASE("a run whose done destroys the owner ends without touching it") {
  auto reload = std::make_unique<ngn::ReloadThread>();
  std::atomic<bool> returned{false};
  auto alive = std::make_shared<int>(1);
  reload->start([&reload, &returned, alive] {
    reload->join([] {});
    reload.reset();
    returned = *alive == 1;
  });
  waitFor(returned);
  CHECK(reload == nullptr);
  // The detached run's tail writes only its own state.
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
}

TEST_CASE("a close refuses a run started from a done after it began, and waits for every run") {
  UiQueue ui;
  ngn::ReloadThread reload;
  std::atomic<bool> closing{false};
  std::atomic<bool> nextStarted{false};
  std::atomic<bool> nextRan{false};
  std::atomic<bool> firstEnded{false};
  reload.start([&] {
    // `done` reloads once the owner has begun to shut down.
    waitFor(closing);
    reload.join([] {});
    nextStarted = reload.start([&] { nextRan = true; });
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    firstEnded = true;
  });
  reload.close([&] {
    closing = true;
    ui.serve();
  });
  CHECK(firstEnded);
  CHECK_FALSE(nextStarted);
  CHECK_FALSE(nextRan);
  // Closed for good: a later start is refused too.
  CHECK_FALSE(reload.start([&] { nextRan = true; }));
  CHECK_FALSE(nextRan);
}
