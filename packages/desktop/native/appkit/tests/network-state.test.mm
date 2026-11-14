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
  REQUIRE(dispatch_semaphore_wait(reported, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  stop();
  int after = reports;
  // A satisfied path uses an interface; an unsatisfied one is NONE whatever it lists.
  if (path.satisfied) {
    CHECK((path.wifi || path.ethernet || path.cellular || path.other));
  }
  CHECK(ngn::networkStateOf(path)["isConnected"] == folly::dynamic(path.satisfied));
  usleep(100 * 1000);
  CHECK(reports == after);
}
