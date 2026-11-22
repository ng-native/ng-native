#include "ngn/animated-frame-loop.h"

#include <doctest/doctest.h>

#include <chrono>
#include <future>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

// Whether `holds` came true within two seconds: a test whose other thread never reaches the point
// it waits for fails, rather than hanging.
template <typename Condition>
bool waitFor(Condition holds) {
  auto until = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (!holds()) {
    if (std::chrono::steady_clock::now() > until) {
      return false;
    }
    std::this_thread::yield();
  }
  return true;
}

} // namespace

TEST_CASE("AnimatedFrameLoop renders every frame between a start and a stop") {
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  int renders = 0;

  CHECK_FALSE(frames.wanted());
  loop.start([&] { ++renders; });
  CHECK(frames.wanted());

  frames.frame(16);
  frames.frame(32);
  frames.frame(48);
  CHECK(renders == 3);

  loop.stop();
  frames.frame(64);
  CHECK(renders == 3);
  // Nothing waits once a stopped loop's last request has run: the display link stops.
  CHECK_FALSE(frames.wanted());
}

TEST_CASE("AnimatedFrameLoop stops from inside a render, as React Native's manager stops it") {
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  int renders = 0;
  loop.start([&] {
    if (++renders == 2) {
      loop.stop();
    }
  });
  frames.frame(16);
  frames.frame(32);
  frames.frame(48);
  CHECK(renders == 2);
  CHECK_FALSE(frames.wanted());
}

TEST_CASE("AnimatedFrameLoop started again renders once a frame, with the newest callback") {
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  int first = 0;
  int second = 0;
  loop.start([&] { ++first; });
  // Stopped and started again before a frame: the first request is still waiting, and must not
  // become a second render a frame beside the new one.
  loop.stop();
  loop.start([&] { ++second; });
  frames.frame(16);
  frames.frame(32);
  CHECK(first == 0);
  CHECK(second == 2);

  // A start while running takes the newest callback and asks for no second frame.
  loop.start([&] { ++first; });
  frames.frame(48);
  CHECK(first == 1);
  CHECK(second == 2);
}

TEST_CASE("AnimatedFrameLoop renders nothing once it is gone") {
  ngn::AnimationFrames frames;
  int renders = 0;
  {
    ngn::AnimatedFrameLoop loop(frames);
    loop.start([&] { ++renders; });
  }
  frames.frame(16);
  CHECK(renders == 0);
  CHECK_FALSE(frames.wanted());
}

TEST_CASE("AnimatedFrameLoop's stop from another thread waits for a render running on this one") {
  // A reload destroys React Native's animated manager on its own thread, stopping the loop on the
  // way, while the UI thread may be inside the manager's render: the stop must outlast it.
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  std::mutex order;
  std::vector<std::string> events;
  auto note = [&](const char *event) {
    std::lock_guard lock(order);
    events.emplace_back(event);
  };
  std::promise<void> rendering;
  std::promise<void> finish;
  auto finished = finish.get_future().share();
  loop.start([&] {
    rendering.set_value();
    finished.wait();
    note("render returned");
  });
  std::thread ui([&] { frames.frame(16); });
  rendering.get_future().wait();
  std::thread reload([&] {
    loop.stop();
    note("stop returned");
  });
  // Once the stop is waiting for the render: one that does not wait never is, and has returned.
  CHECK(waitFor([&] { return loop.waiting() > 0; }));
  finish.set_value();
  reload.join();
  ui.join();
  CHECK(events == std::vector<std::string>{"render returned", "stop returned"});
}

TEST_CASE("AnimatedFrameLoop's close waits for a render that stopped itself, and starts nothing after") {
  // React Native's manager stops the loop from inside its render once nothing animates, clearing
  // its own flag first, so its destructor then stops nothing: a reload closes the loop itself,
  // before it destroys the manager, and must outlast that render.
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  std::mutex order;
  std::vector<std::string> events;
  auto note = [&](const char *event) {
    std::lock_guard lock(order);
    events.emplace_back(event);
  };
  std::promise<void> rendering;
  std::promise<void> finish;
  auto finished = finish.get_future().share();
  loop.start([&] {
    loop.stop();
    rendering.set_value();
    finished.wait();
    note("render returned");
  });
  std::thread ui([&] { frames.frame(16); });
  rendering.get_future().wait();
  std::thread reload([&] {
    loop.close();
    note("close returned");
  });
  // Once the close is waiting for the render: one that does not wait never is, and has returned.
  CHECK(waitFor([&] { return loop.waiting() > 0; }));
  finish.set_value();
  reload.join();
  ui.join();
  CHECK(events == std::vector<std::string>{"render returned", "close returned"});

  // Closed for good: a start from the manager that is going renders nothing.
  int renders = 0;
  loop.start([&] { ++renders; });
  frames.frame(32);
  CHECK(renders == 0);
  CHECK_FALSE(frames.wanted());
}

TEST_CASE("AnimatedFrameLoop keeps a start that arrives while a render is stopping it") {
  // React Native clears its own started flag before it stops the loop from inside its render, so
  // JavaScript can start it again in between: that start must not be lost to the stop after it,
  // or no frame comes and React Native, believing the loop runs, never starts it again.
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  int first = 0;
  int second = 0;
  loop.start([&] {
    ++first;
    std::thread javascript([&] { loop.start([&] { ++second; }); });
    javascript.join();
    loop.stop();
  });
  frames.frame(16);
  frames.frame(32);
  frames.frame(48);
  CHECK(first == 1);
  CHECK(second == 2);
}

TEST_CASE("AnimatedFrameLoop's stop from another thread stops it, though a start came during the render") {
  // Only the render's own stop is one a start overtook: a stop from elsewhere stops the loop, and
  // waits for the render, as it would with no start.
  ngn::AnimationFrames frames;
  ngn::AnimatedFrameLoop loop(frames);
  int renders = 0;
  std::promise<void> started;
  std::promise<void> finish;
  auto finished = finish.get_future().share();
  loop.start([&] {
    if (++renders > 1) {
      return;
    }
    std::thread javascript([&] { loop.start([&] { ++renders; }); });
    javascript.join();
    started.set_value();
    finished.wait();
  });
  std::thread ui([&] { frames.frame(16); });
  started.get_future().wait();
  std::thread other([&] { loop.stop(); });
  CHECK(waitFor([&] { return loop.waiting() > 0; }));
  finish.set_value();
  other.join();
  ui.join();
  CHECK_FALSE(loop.running());
  frames.frame(32);
  CHECK(renders == 1);
}
