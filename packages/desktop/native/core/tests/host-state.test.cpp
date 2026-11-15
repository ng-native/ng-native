#include "ngn/host-state.h"

#include "helpers.h"

#include <doctest/doctest.h>

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
