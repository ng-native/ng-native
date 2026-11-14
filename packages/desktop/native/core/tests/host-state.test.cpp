#include "ngn/host-state.h"

#include <doctest/doctest.h>

#include <atomic>
#include <chrono>
#include <thread>

using namespace std::chrono_literals;

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
  std::atomic<bool> running{false};
  std::atomic<bool> finished{false};
  auto handle = value.listen([&](const int &) {
    running = true;
    std::this_thread::sleep_for(200ms);
    finished = true;
  });
  std::thread setter([&] { value.set(1); });
  while (!running) {
    std::this_thread::yield();
  }
  // The module this listener belongs to is being destroyed: once the handle is gone, nothing may
  // call into it.
  handle.reset();
  CHECK(finished);
  setter.join();
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
  std::atomic<bool> running{false};
  std::atomic<bool> finished{false};
  auto handle = state.listenForUrls([&](const std::string &) {
    running = true;
    std::this_thread::sleep_for(200ms);
    finished = true;
  });
  std::thread opener([&] { state.openUrl("ngn://x"); });
  while (!running) {
    std::this_thread::yield();
  }
  handle.reset();
  CHECK(finished);
  opener.join();
}
