// NetworkPathMonitor (network-state.mm) on the Mac running the tests: it reports the current path
// at once, and nothing after it is stopped.
#include "../network-state.h"

#include <doctest/doctest.h>

#include <atomic>
#include <dispatch/dispatch.h>
#include <unistd.h>

TEST_CASE("NetworkPathMonitor reports this Mac's path, and stops") {
  auto monitor = ngn::appkit::makePathMonitor();
  dispatch_semaphore_t reported = dispatch_semaphore_create(0);
  std::atomic<int> reports{0};
  ngn::NetworkPath path;
  auto stop = monitor->watch([&](const ngn::NetworkPath &now) {
    if (reports++ == 0) {
      path = now;
      dispatch_semaphore_signal(reported);
    }
  });
  // Stopped before any assertion, so no change can reach the locals after the test leaves.
  bool answered = dispatch_semaphore_wait(reported, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0;
  stop();
  REQUIRE(answered);
  int after = reports;
  // A satisfied path uses an interface; an unsatisfied one is NONE whatever it lists.
  if (path.satisfied) {
    CHECK((path.wifi || path.ethernet || path.cellular || path.other));
  }
  CHECK(ngn::networkStateOf(path)["isConnected"] == folly::dynamic(path.satisfied));
  usleep(100 * 1000);
  CHECK(reports == after);
}

TEST_CASE("NetworkPathMonitor stops from inside its own change without waiting for itself") {
  auto monitor = ngn::appkit::makePathMonitor();
  auto stop = std::make_shared<std::function<void()>>();
  auto state = std::make_shared<std::pair<std::atomic<int>, dispatch_semaphore_t>>();
  state->second = dispatch_semaphore_create(0);
  dispatch_semaphore_t ready = dispatch_semaphore_create(0);
  *stop = monitor->watch([stop, state, ready](const ngn::NetworkPath &) {
    if (state->first++ == 0) {
      dispatch_semaphore_wait(ready, DISPATCH_TIME_FOREVER);
      (*stop)();
      dispatch_semaphore_signal(state->second);
    }
  });
  dispatch_semaphore_signal(ready);
  bool returned = dispatch_semaphore_wait(state->second, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0;
  // A second stop, from here, returns at once.
  (*stop)();
  REQUIRE(returned);
  usleep(100 * 1000);
  CHECK(state->first == 1);
  *stop = nullptr;
}

TEST_CASE("NetworkPathMonitor stopped from another monitor's change waits for its own change to finish") {
  auto monitor = ngn::appkit::makePathMonitor();
  struct State {
    dispatch_semaphore_t bRunning = dispatch_semaphore_create(0);
    dispatch_semaphore_t aFinished = dispatch_semaphore_create(0);
    std::atomic<bool> bDone{false};
    std::atomic<bool> doneAtStop{false};
    std::atomic<int> aReports{0};
    std::atomic<int> bReports{0};
    std::function<void()> stopB;
  };
  auto state = std::make_shared<State>();
  state->stopB = monitor->watch([state](const ngn::NetworkPath &) {
    if (state->bReports++ == 0) {
      dispatch_semaphore_signal(state->bRunning);
      usleep(300 * 1000);
      state->bDone = true;
    }
  });
  auto stopA = monitor->watch([state](const ngn::NetworkPath &) {
    if (state->aReports++ == 0) {
      if (dispatch_semaphore_wait(state->bRunning, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0) {
        state->stopB();
        state->doneAtStop = state->bDone.load();
      }
      dispatch_semaphore_signal(state->aFinished);
    }
  });
  bool finished = dispatch_semaphore_wait(state->aFinished, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) == 0;
  stopA();
  state->stopB();
  REQUIRE(finished);
  // B's stop returned only once B's change had finished.
  CHECK(state->doneAtStop);
}
