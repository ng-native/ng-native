#include "ngn/host-state.h"

#include "helpers.h"

#include <doctest/doctest.h>

#include <functional>
#include <vector>

TEST_CASE("Watched calls each listener with a change, and stops when its handle goes") {
  ngn::Watched<int> value{1};
  std::vector<int> seen;
  auto handle = value.listen([&](const int &v) { seen.push_back(v); });
  value.set(1);
  value.set(2);
  handle.reset();
  value.set(3);
  CHECK(seen == std::vector<int>{2});
}

TEST_CASE("Dropping a Watched listener waits for a call to it already running on another thread") {
  ngn::Watched<int> value{0};
  // The module a listener belongs to is being destroyed: once the handle is gone, nothing may call
  // into it.
  CHECK(ngn::testing::dropWaitsForRunningCall([&](auto listener) { return value.listen(listener); }, [&] { value.set(1); }));
}

TEST_CASE("dropWaitsForRunningCall answers false for a handle whose drop does not wait") {
  std::function<void(const int &)> listener;
  auto listen = [&](auto added) {
    listener = added;
    return std::make_shared<int>(0);
  };
  CHECK_FALSE(ngn::testing::dropWaitsForRunningCall(listen, [&] { listener(1); }));
}

TEST_CASE("dropWaitsForRunningCall reports a held call that gave up, not a drop that did not wait") {
  ngn::Watched<int> value{0};
  // The held call gives up after 50 ms, before the 200 ms the drop is given, so a drop that waits
  // finishes inside it.
  CHECK_THROWS_AS(
      ngn::testing::dropWaitsForRunningCall(
          [&](auto listener) { return value.listen(listener); }, [&] { value.set(1); }, std::chrono::milliseconds(50)),
      std::runtime_error);
}

TEST_CASE("A listener can drop its own handle while it is being called") {
  ngn::Watched<int> value{0};
  std::shared_ptr<void> handle;
  int calls = 0;
  handle = value.listen([&](const int &) {
    calls++;
    handle.reset();
  });
  value.set(1);
  value.set(2);
  CHECK(calls == 1);
}

TEST_CASE("Dropping a URL listener waits for a call to it already running on another thread") {
  ngn::HostState state;
  CHECK(ngn::testing::dropWaitsForRunningCall(
      [&](auto listener) { return state.listenForUrls(listener); }, [&] { state.openUrl("ngn://x"); }));
}

TEST_CASE("Listeners answer how many listeners a notify called, leaving out one dropped during it") {
  ngn::Listeners<int> listeners;
  std::shared_ptr<void> second;
  int secondCalls = 0;
  auto first = listeners.add([&](const int &) { second.reset(); });
  second = listeners.add([&](const int &) { secondCalls++; });
  CHECK(listeners.notify(1) == 1);
  CHECK(secondCalls == 0);
  first.reset();
  CHECK(listeners.notify(2) == 0);
}

TEST_CASE("Watched sends values in the order they were set, one a listener sets after the one it hears") {
  ngn::Watched<int> value{0};
  std::vector<int> first;
  std::vector<int> second;
  auto a = value.listen([&](const int &v) {
    first.push_back(v);
    if (v == 1) {
      value.set(2);
    }
  });
  auto b = value.listen([&](const int &v) { second.push_back(v); });
  value.set(1);
  CHECK(value.get() == 2);
  CHECK(first == std::vector<int>{1, 2});
  // Without the queue, b heard 2 inside a's call and then 1, ending on a value that is not set.
  CHECK(second == std::vector<int>{1, 2});
}

TEST_CASE("Watched gives a new listener the value its first call follows") {
  ngn::Watched<int> value{1};
  int current = 0;
  std::vector<std::pair<int, int>> changes;
  auto handle = value.listen(
      [&](const int &now) {
        changes.emplace_back(current, now);
        current = now;
      },
      current);
  CHECK(current == 1);
  value.set(2);
  CHECK(changes == std::vector<std::pair<int, int>>{{1, 2}});
}

TEST_CASE("Watched leaves out of a new listener's calls the values set before it listened") {
  ngn::Watched<int> value{0};
  int current = -1;
  std::vector<std::pair<int, int>> changes;
  std::shared_ptr<void> late;
  // While 1 is being sent, 2 and 3 are set and queued, and then a listener joins: its first call
  // follows 3, so it hears neither 2 nor 3 (3, 2, 3 without the boundary).
  auto first = value.listen([&](const int &v) {
    if (v != 1) {
      return;
    }
    value.set(2);
    value.set(3);
    late = value.listen(
        [&](const int &now) {
          changes.emplace_back(current, now);
          current = now;
        },
        current);
  });
  value.set(1);
  CHECK(current == 3);
  CHECK(changes.empty());
  value.set(4);
  CHECK(changes == std::vector<std::pair<int, int>>{{3, 4}});
}

TEST_CASE("Linux's accessibility settings: any source reducing motion reduces it, and the rest stay off") {
  ngn::LinuxAccessibilitySources sources;
  CHECK(ngn::linuxAccessibility(sources) == ngn::AccessibilitySettings{});
  sources.animations = false;
  CHECK(ngn::linuxAccessibility(sources).reduceMotion);
  sources.animations = true;
  sources.portalReducedMotion = true;
  CHECK(ngn::linuxAccessibility(sources).reduceMotion);
  sources.portalReducedMotion = false;
  sources.gtkReducedMotion = true;
  CHECK(ngn::linuxAccessibility(sources).reduceMotion);
  sources = {.highContrast = true, .screenReader = true};
  CHECK(ngn::linuxAccessibility(sources) == ngn::AccessibilitySettings{.screenReader = true, .increaseContrast = true});
}
