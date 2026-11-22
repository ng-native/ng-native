#include "ngn/animated-frame-loop.h"

#include <doctest/doctest.h>

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
