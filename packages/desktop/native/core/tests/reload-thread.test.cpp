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
  ngn::ReloadThread::Post poster() {
    return [this](std::function<void()> task) { post(std::move(task)); };
  }
  // From a run's thread: posts to the UI queue and waits, up to a while, for it to run.
  bool roundTrip() {
    auto ran = std::make_shared<std::atomic<bool>>(false);
    post([ran] { *ran = true; });
    auto until = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    while (!*ran && std::chrono::steady_clock::now() < until) {
      std::this_thread::yield();
    }
    return *ran;
  }
  // Serves the queue until `flag` is set.
  void serveUntil(const std::atomic<bool> &flag) {
    while (!flag) {
      serve();
      std::this_thread::yield();
    }
  }
};

void waitFor(const std::atomic<bool> &flag) {
  while (!flag) {
    std::this_thread::yield();
  }
}

} // namespace

TEST_CASE("a run's then comes on the UI queue once its worker has been joined") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> served{false};
  std::atomic<bool> told{false};
  std::thread::id worker;
  std::thread::id toldOn;
  bool ran = false;
  reload.start(
      [&] {
        worker = std::this_thread::get_id();
        served = ui.roundTrip();
      },
      [&](bool r) {
        ran = r;
        toldOn = std::this_thread::get_id();
        told = true;
      });
  ui.serveUntil(told);
  CHECK(served);
  CHECK(ran);
  CHECK(toldOn == std::this_thread::get_id());
  CHECK(toldOn != worker);
}

TEST_CASE("a then that starts a second run starts it after the first run's worker ended") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> firstEnded{false};
  std::atomic<bool> secondSawFirstEnded{false};
  std::atomic<bool> secondTold{false};
  reload.start([&] { firstEnded = true; },
               [&](bool) {
                 reload.start([&] { secondSawFirstEnded = firstEnded.load() && ui.roundTrip(); },
                              [&](bool ran) { secondTold = ran; });
               });
  ui.serveUntil(secondTold);
  CHECK(secondSawFirstEnded);
}

TEST_CASE("a run asked for from a run's own work waits its turn, and starts after that run's then") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> firstTold{false};
  std::atomic<bool> secondSawFirstTold{false};
  std::atomic<bool> secondTold{false};
  bool queued = false;
  reload.start(
      [&] {
        queued = reload.start([&] { secondSawFirstTold = firstTold.load(); }, [&](bool ran) { secondTold = ran; });
      },
      [&](bool) { firstTold = true; });
  ui.serveUntil(secondTold);
  CHECK(queued);
  CHECK(secondSawFirstTold);
}

TEST_CASE("a then that destroys the owner leaves nothing touching it") {
  UiQueue ui;
  auto reload = std::make_unique<ngn::ReloadThread>(ui.poster());
  std::atomic<bool> told{false};
  reload->start([&] { ui.roundTrip(); },
                [&](bool) {
                  reload.reset();
                  told = true;
                });
  ui.serveUntil(told);
  CHECK(reload == nullptr);
  // Whatever the run left queued touches only its own state.
  ui.serve();
}

TEST_CASE("a then that starts a run during a concurrent close is refused, and nothing runs after the close") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> closing{false};
  std::atomic<int> inside{0};
  std::atomic<bool> nextRan{false};
  std::atomic<bool> nextRefused{false};
  bool firstRan = false;
  reload.start(
      [&] {
        inside++;
        waitFor(closing);
        ui.roundTrip();
        inside--;
      },
      [&](bool ran) {
        firstRan = ran;
        // `done` reloads as the owner shuts down.
        reload.start([&] { nextRan = true; }, [&](bool ran) { nextRefused = !ran; });
      });
  reload.close([&] {
    closing = true;
    ui.serve();
  });
  CHECK(inside == 0);
  CHECK(firstRan);
  CHECK(nextRefused);
  ui.serve();
  CHECK_FALSE(nextRan);
  bool refused = false;
  CHECK_FALSE(reload.start([&] { nextRan = true; }, [&](bool ran) { refused = !ran; }));
  CHECK(refused);
  CHECK_FALSE(nextRan);
}

TEST_CASE("a then that starts a run before a close from another thread is joined by that close") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<int> inside{0};
  std::atomic<bool> secondStarted{false};
  std::atomic<bool> closed{false};
  std::atomic<int> insideAtClose{-1};
  reload.start([] {},
               [&](bool) {
                 reload.start(
                     [&] {
                       inside++;
                       secondStarted = true;
                       // Needs the UI queue, which keeps being served while the close waits.
                       ui.roundTrip();
                       std::this_thread::sleep_for(std::chrono::milliseconds(20));
                       inside--;
                     },
                     nullptr);
               });
  std::thread closer([&] {
    waitFor(secondStarted);
    reload.close([] {});
    insideAtClose = inside.load();
    closed = true;
  });
  ui.serveUntil(closed);
  closer.join();
  CHECK(insideAtClose == 0);
}

TEST_CASE("a close from another thread waits for a then still running on the UI queue") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> inThen{false};
  std::atomic<bool> release{false};
  std::atomic<bool> thenEnded{false};
  std::atomic<bool> closed{false};
  std::atomic<bool> thenEndedAtClose{false};
  reload.start([] {},
               [&](bool) {
                 inThen = true;
                 waitFor(release);
                 std::this_thread::sleep_for(std::chrono::milliseconds(10));
                 thenEnded = true;
               });
  std::thread uiThread([&] { ui.serveUntil(inThen); });
  waitFor(inThen);
  std::thread closer([&] {
    reload.close([] {});
    thenEndedAtClose = thenEnded.load();
    closed = true;
  });
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  CHECK_FALSE(closed);
  release = true;
  closer.join();
  uiThread.join();
  CHECK(thenEndedAtClose);
}

TEST_CASE("a close while a second run waits its turn drops it, and joins the first, serving the UI queue") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> closing{false};
  std::atomic<bool> firstServed{false};
  std::atomic<bool> secondRan{false};
  bool firstRan = false;
  bool secondRefused = false;
  reload.start(
      [&] {
        waitFor(closing);
        firstServed = ui.roundTrip();
      },
      [&](bool ran) { firstRan = ran; });
  std::thread asker([&] { CHECK(reload.start([&] { secondRan = true; }, [&](bool ran) { secondRefused = !ran; })); });
  asker.join();
  reload.close([&] {
    closing = true;
    ui.serve();
  });
  CHECK(firstServed);
  CHECK(firstRan);
  CHECK(secondRefused);
  ui.serve();
  CHECK_FALSE(secondRan);
}

TEST_CASE("a then that close runs can destroy the owner, and close touches nothing of it after") {
  UiQueue ui;
  auto reload = std::make_unique<ngn::ReloadThread>(ui.poster());
  std::atomic<bool> closing{false};
  bool ran = false;
  bool dropped = false;
  reload->start([&] { waitFor(closing); },
                [&](bool value) {
                  ran = value;
                  reload.reset();
                });
  // A second run waits its turn, so close drops it after the first run's then destroyed the owner.
  reload->start([] {}, [&](bool value) { dropped = !value; });
  auto *owner = reload.get();
  owner->close([&] {
    closing = true;
    ui.serve();
  });
  CHECK(ran);
  CHECK(dropped);
  CHECK(reload == nullptr);
  ui.serve();
}

TEST_CASE("a second close while the first is joining waits for the run to end") {
  UiQueue ui;
  ngn::ReloadThread reload(ui.poster());
  std::atomic<bool> release{false};
  std::atomic<bool> workerDone{false};
  std::atomic<bool> firstJoining{false};
  reload.start(
      [&] {
        waitFor(release);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        workerDone = true;
      },
      [](bool) {});
  std::thread first([&] {
    reload.close([&] {
      firstJoining = true;
      ui.serve();
    });
  });
  waitFor(firstJoining);
  std::atomic<bool> secondReturned{false};
  bool doneWhenSecondReturned = false;
  std::thread second([&] {
    reload.close([&] { ui.serve(); });
    doneWhenSecondReturned = workerDone;
    secondReturned = true;
  });
  // The second close must still be waiting: the run has not been let go.
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  CHECK_FALSE(secondReturned);
  release = true;
  first.join();
  second.join();
  CHECK(doneWhenSecondReturned);
}
