#include "ngn/worklet-host.h"

#include <doctest/doctest.h>

#include <atomic>
#include <memory>
#include <thread>
#include <vector>

TEST_CASE("A worklet host callback set, read and cleared from three threads at once is always whole") {
  // The reload clears wakeUiFrames and reanimatedEvent on its own thread while the UI thread may be
  // calling them (worklet-host.h): every call sees a whole callback or none.
  auto &host = ngn::workletHost();
  std::atomic<bool> stop{false};
  std::atomic<long> calls{0};
  std::atomic<long> events{0};
  std::thread reader([&] {
    while (!stop) {
      host.wakeUiFrames.call();
      host.reanimatedEvent.call("onGestureHandlerEvent", 7, folly::dynamic::object("state", 4));
    }
  });
  std::thread runner([&] {
    while (!stop) {
      host.runOnScheduler.call([](facebook::react::Scheduler &) {});
    }
  });
  for (int i = 0; i < 20000; ++i) {
    // A closure owning state, as the glue's do: a torn read or a freed closure would touch freed
    // memory, or count into the wrong place.
    auto counter = std::make_shared<std::vector<int>>(64, 1);
    host.wakeUiFrames.set([counter, &calls] { calls += (*counter)[63]; });
    host.reanimatedEvent.set([counter, &events](const std::string &name, facebook::react::Tag tag, const folly::dynamic &payload) {
      events += (*counter)[0] * (name.size() == 21 && tag == 7 && payload["state"] == 4 ? 1 : 1000);
    });
    host.runOnScheduler.set([counter](std::function<void(facebook::react::Scheduler &)>) { CHECK((*counter)[1] == 1); });
    host.wakeUiFrames.set(nullptr);
    host.reanimatedEvent.set(nullptr);
    host.runOnScheduler.set(nullptr);
  }
  stop = true;
  reader.join();
  runner.join();
  CHECK(events.load() < 1000 * 1000);
  // Cleared, nothing is called and the caller is told so.
  CHECK_FALSE(host.wakeUiFrames.call());
  CHECK_FALSE(host.wakeUiFrames);
}

TEST_CASE("A worklet host callback keeps running when it is cleared during the call") {
  auto &host = ngn::workletHost();
  bool ran = false;
  auto owned = std::make_shared<int>(5);
  host.wakeUiFrames.set([owned, &ran] {
    // Clearing drops the slot's reference; the call still holds its own.
    ngn::workletHost().wakeUiFrames.set(nullptr);
    ran = *owned == 5;
  });
  owned.reset();
  CHECK(host.wakeUiFrames.call());
  CHECK(ran);
  CHECK_FALSE(host.wakeUiFrames);
}
