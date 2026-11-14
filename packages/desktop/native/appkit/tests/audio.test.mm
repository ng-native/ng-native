// AVOutput and AVInput (audio.mm) in the test binary: a WAV written here plays at zero volume, and
// the binary has no Info.plist, so no usage string, and asking for the microphone shows nothing.
#include "../audio.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <unistd.h>

namespace {

// A mono 16-bit PCM WAV of a 440 Hz tone, `seconds` long.
std::string writeTone(double seconds) {
  const uint32_t rate = 22050;
  const auto frames = static_cast<uint32_t>(rate * seconds);
  std::string path = std::string(NSTemporaryDirectory().UTF8String) + "ngn-audio-" + std::to_string(getpid()) + ".wav";
  FILE *file = std::fopen(path.c_str(), "wb");
  REQUIRE(file != nullptr);
  auto u32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, file); };
  auto u16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, file); };
  std::fwrite("RIFF", 1, 4, file);
  u32(36 + frames * 2);
  std::fwrite("WAVEfmt ", 1, 8, file);
  u32(16);
  u16(1);
  u16(1);
  u32(rate);
  u32(rate * 2);
  u16(2);
  u16(16);
  std::fwrite("data", 1, 4, file);
  u32(frames * 2);
  for (uint32_t i = 0; i < frames; i++) {
    u16(static_cast<uint16_t>(static_cast<int16_t>(8000 * std::sin(2 * M_PI * 440 * i / rate))));
  }
  std::fclose(file);
  return path;
}

// Runs the main run loop until `done` or `limit` seconds pass, as the host's main thread would.
template <typename Done>
bool runUntil(Done done, double limit) {
  auto until = [NSDate dateWithTimeIntervalSinceNow:limit];
  while (!done() && [until timeIntervalSinceNow] > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  return done();
}

} // namespace

TEST_CASE("AVOutput plays a WAV at zero volume: it loads, its position advances, and it ends") {
  auto path = writeTone(0.8);
  std::atomic<int> states{0};
  std::atomic<bool> ended{false};
  auto track = ngn::appkit::makeAudioOutput()->open("file://" + path, 0.1, [&](ngn::AudioOutput::Change change) {
    if (change == ngn::AudioOutput::Change::Ended) {
      ended = true;
    } else {
      states++;
    }
  });
  track->setVolume(0);
  REQUIRE(runUntil([&] { return track->state().load == ngn::TrackState::Load::Ready; }, 5));
  CHECK(track->state().duration == doctest::Approx(0.8).epsilon(0.05));
  CHECK(track->state().currentTime == 0);
  track->play(1);
  REQUIRE(runUntil([&] { return track->state().currentTime > 0.2; }, 3));
  CHECK(track->state().playing);
  CHECK(states > 1);
  REQUIRE(runUntil([&] { return ended.load(); }, 3));
  CHECK(runUntil([&] { return !track->state().playing; }, 1));
  CHECK(track->state().currentTime == doctest::Approx(0.8).epsilon(0.05));

  bool sought = false;
  track->seek(0.25, [&] { sought = true; });
  REQUIRE(runUntil([&] { return sought; }, 3));
  CHECK(track->state().currentTime == doctest::Approx(0.25).epsilon(0.01));
  track.reset();
  std::remove(path.c_str());
}

TEST_CASE("AVOutput's track for a file that is not there fails to load, with the reason") {
  auto track = ngn::appkit::makeAudioOutput()->open("file:///nonexistent/ngn-audio.wav", 0.5, [](ngn::AudioOutput::Change) {});
  REQUIRE(runUntil([&] { return track->state().load == ngn::TrackState::Load::Failed; }, 5));
  CHECK_FALSE(track->state().error.empty());
}

TEST_CASE("AVInput asks for nothing without a usage string, and the module records nothing without access") {
  auto input = ngn::appkit::makeAudioInput();
  auto before = input->access();
  std::optional<ngn::AudioInput::Access> answered;
  input->requestAccess([&](ngn::AudioInput::Access access) { answered = access; });
  // Answered at once, on this thread: nothing was shown.
  REQUIRE(answered);
  CHECK(*answered == before);
  if (before == ngn::AudioInput::Access::Granted) {
    MESSAGE("this test binary has microphone access; the denied path is not checked");
    return;
  }
  auto module = ngn::makeAudioModule(ngn::appkit::makeAudioOutput(), input, NSTemporaryDirectory().UTF8String, false);
  auto id = module->call("createRecorder", folly::dynamic::array(folly::dynamic::object()));
  std::optional<std::string> rejected;
  module->callWithPromise("prepareToRecordAsync", folly::dynamic::array(id, nullptr),
                          {.resolve = [](folly::dynamic) {}, .reject = [&](const std::string &m) { rejected = m; }});
  REQUIRE(rejected);
  CHECK(module->call("recorderStatus", folly::dynamic::array(id))["canRecord"] == folly::dynamic(false));
}
