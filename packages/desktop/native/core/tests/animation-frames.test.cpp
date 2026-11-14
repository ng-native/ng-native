#include "ngn/animation-frames.h"

#include <doctest/doctest.h>

#include <vector>

TEST_CASE("AnimationFrames wants frames only while a callback waits for one") {
  ngn::AnimationFrames frames;
  std::vector<bool> wanted;
  frames.onWanted = [&](bool on) { wanted.push_back(on); };

  // Idle: no frame is asked for, so the display link stays stopped.
  CHECK_FALSE(frames.wanted());
  frames.frame(10);
  CHECK(wanted.empty());

  std::vector<double> seen;
  frames.request([&](double ms) { seen.push_back(ms); });
  frames.request([&](double ms) { seen.push_back(ms + 1); });
  // Asked once, however many callbacks wait.
  CHECK(wanted == std::vector<bool>{true});
  CHECK(frames.wanted());

  frames.frame(16.5);
  CHECK(seen == std::vector<double>{16.5, 17.5});
  // Nothing waits now: the link stops after the frame that ran the last callbacks.
  CHECK(wanted == std::vector<bool>{true, false});
  CHECK_FALSE(frames.wanted());

  // A frame with nothing to run runs nothing and asks for nothing.
  frames.frame(33);
  CHECK(seen.size() == 2);
  CHECK(wanted.size() == 2);
}

TEST_CASE("AnimationFrames runs a callback requested during a frame on the next frame") {
  ngn::AnimationFrames frames;
  std::vector<bool> wanted;
  frames.onWanted = [&](bool on) { wanted.push_back(on); };
  int runs = 0;
  std::function<void(double)> again = [&](double) {
    if (++runs < 3) {
      frames.request(again);
    }
  };
  frames.request(again);
  frames.frame(1);
  CHECK(runs == 1);
  // The link keeps running through the frames an animation asks for, without stopping between.
  CHECK(wanted == std::vector<bool>{true});
  frames.frame(2);
  CHECK(runs == 2);
  frames.frame(3);
  CHECK(runs == 3);
  CHECK(wanted == std::vector<bool>{true, false});
}

TEST_CASE("AnimationFrames drops what waits when it is cleared, and stops the link") {
  ngn::AnimationFrames frames;
  std::vector<bool> wanted;
  frames.onWanted = [&](bool on) { wanted.push_back(on); };
  bool ran = false;
  frames.request([&](double) { ran = true; });
  frames.clear();
  CHECK(wanted == std::vector<bool>{true, false});
  frames.frame(1);
  CHECK_FALSE(ran);
}
