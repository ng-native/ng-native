#include "fake-backend.h"
#include "ngn/mounting-manager.h"
#include "ngn/video.h"

#include <doctest/doctest.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/utils/ContextContainer.h>

#include <optional>
#include <vector>

using namespace facebook::react;
using folly::dynamic;
using Change = ngn::VideoPlayback::Change;

namespace {

struct FakePlayback final : ngn::VideoPlayback {
  struct Log {
    std::vector<std::string> calls;
    int destroyed{0};
  };
  std::shared_ptr<Log> log;
  ngn::VideoState now;
  std::optional<std::string> uri;
  std::function<void(Change)> changed;
  std::function<void()> pendingSeek;
  double volume{1};
  bool muted{false};
  double interval{0};
  explicit FakePlayback(std::shared_ptr<Log> l) : log(std::move(l)) {}
  ~FakePlayback() override {
    log->destroyed++;
  }
  void load(const std::optional<std::string> &u, std::function<void(Change)> c) override {
    log->calls.push_back("load " + u.value_or("none"));
    uri = u;
    changed = std::move(c);
    now = {};
  }
  ngn::VideoState state() override {
    return now;
  }
  void play(double rate) override {
    log->calls.push_back("play " + std::to_string(rate).substr(0, 3));
    now.playing = true;
  }
  void pause() override {
    log->calls.push_back("pause");
    now.playing = false;
  }
  void seek(double seconds, std::function<void()> done) override {
    log->calls.push_back("seek " + std::to_string(seconds).substr(0, 3));
    now.currentTime = seconds;
    pendingSeek = std::move(done);
  }
  void setRate(double rate) override {
    log->calls.push_back("rate " + std::to_string(rate).substr(0, 3));
  }
  void setVolume(double v) override {
    volume = v;
  }
  void setMuted(bool m) override {
    muted = m;
  }
  void setPreservesPitch(bool preserves) override {
    log->calls.push_back(preserves ? "pitch kept" : "pitch varies");
  }
  void setTimeUpdates(double i) override {
    interval = i;
  }
  // The backend reporting a change, as it would from AVPlayer.
  void report(Change change) {
    changed(change);
  }
};

struct FakeOutput final : ngn::VideoOutput {
  std::shared_ptr<FakePlayback::Log> log = std::make_shared<FakePlayback::Log>();
  std::vector<int> made;
  FakePlayback *last{nullptr};
  std::unique_ptr<ngn::VideoPlayback> make(int id) override {
    made.push_back(id);
    auto playback = std::make_unique<FakePlayback>(log);
    last = playback.get();
    return playback;
  }
};

struct Setup {
  std::shared_ptr<FakeOutput> output = std::make_shared<FakeOutput>();
  std::shared_ptr<ngn::NativeModule> module = ngn::makeVideoModule(output);
  std::vector<dynamic> events;
  Setup() {
    module->setEmitter([this](const std::string &event, dynamic body) {
      CHECK(event == "ngNativeVideo");
      events.push_back(std::move(body));
    });
  }
  dynamic call(const std::string &method, dynamic args) {
    return module->call(method, args);
  }
};

std::vector<std::string> types(const std::vector<dynamic> &events) {
  std::vector<std::string> out;
  for (auto &event : events) {
    out.push_back(event["type"].asString());
  }
  return out;
}

} // namespace

TEST_CASE("NgNativeVideo walks expo-video's status from idle through loading to readyToPlay, and sends the source's load once") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///clip.mov"));
  REQUIRE(id.isInt());
  CHECK(setup.output->made == std::vector<int>{static_cast<int>(id.asInt())});
  CHECK(setup.output->last->uri == "file:///clip.mov");
  CHECK(types(setup.events) == std::vector<std::string>{"sourceChange", "statusChange"});
  CHECK(setup.events[0]["id"] == id);
  CHECK(setup.events[0]["payload"]["source"]["uri"] == "file:///clip.mov");
  CHECK(setup.events[0]["payload"]["oldSource"] == nullptr);
  CHECK(setup.events[1]["payload"] == dynamic::object("status", "loading")("oldStatus", "idle"));
  CHECK(setup.call("state", dynamic::array(id))["status"] == "loading");

  // Nothing changed: nothing sent.
  setup.events.clear();
  setup.output->last->report(Change::State);
  CHECK(setup.events.empty());

  setup.output->last->now.load = ngn::VideoState::Load::Ready;
  setup.output->last->now.duration = 2.5;
  setup.output->last->report(Change::State);
  CHECK(types(setup.events) == std::vector<std::string>{"statusChange", "sourceLoad"});
  CHECK(setup.events[0]["payload"] == dynamic::object("status", "readyToPlay")("oldStatus", "loading"));
  auto load = setup.events[1]["payload"];
  CHECK(load["duration"] == 2.5);
  CHECK(load["videoSource"]["uri"] == "file:///clip.mov");
  CHECK(load["availableVideoTracks"] == dynamic::array());
  CHECK(load["availableAudioTracks"] == dynamic::array());
  CHECK(load["availableSubtitleTracks"] == dynamic::array());

  // Ready again later sends no second load.
  setup.events.clear();
  setup.output->last->now.buffering = true;
  setup.output->last->now.playing = true;
  setup.output->last->report(Change::State);
  setup.output->last->now.buffering = false;
  setup.output->last->report(Change::State);
  CHECK(types(setup.events) == std::vector<std::string>{"statusChange", "playingChange", "statusChange"});
  CHECK(setup.events[0]["payload"]["status"] == "loading");
  CHECK(setup.events[1]["payload"] == dynamic::object("isPlaying", true)("oldIsPlaying", false));
  CHECK(setup.events[2]["payload"]["status"] == "readyToPlay");
}

TEST_CASE("NgNativeVideo reports a source that fails as error with its message, and a player with none as idle") {
  Setup setup;
  auto empty = setup.call("createPlayer", dynamic::array(nullptr));
  CHECK(setup.output->last->uri == std::nullopt);
  CHECK(setup.events.empty());
  CHECK(setup.call("state", dynamic::array(empty))["status"] == "idle");

  setup.call("replace", dynamic::array(empty, "https://example.com/missing.mp4"));
  setup.events.clear();
  setup.output->last->now.load = ngn::VideoState::Load::Failed;
  setup.output->last->now.error = "The file could not be opened.";
  setup.output->last->report(Change::State);
  REQUIRE(setup.events.size() == 1);
  CHECK(setup.events[0]["payload"] ==
        dynamic::object("status", "error")("oldStatus", "loading")("error", dynamic::object("message", "The file could not be opened.")));
  CHECK(setup.call("state", dynamic::array(empty))["status"] == "error");

  // Taking the source away is idle again.
  setup.events.clear();
  setup.call("replace", dynamic::array(empty, nullptr));
  CHECK(types(setup.events) == std::vector<std::string>{"sourceChange", "statusChange"});
  CHECK(setup.events[0]["payload"]["source"] == nullptr);
  CHECK(setup.events[0]["payload"]["oldSource"]["uri"] == "https://example.com/missing.mp4");
  CHECK(setup.events[1]["payload"] == dynamic::object("status", "idle")("oldStatus", "error"));
}

TEST_CASE("NgNativeVideo drops a change the replaced source sends late") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///a.mov"));
  auto first = setup.output->last->changed;
  setup.call("replace", dynamic::array(id, "file:///b.mov"));
  CHECK(setup.output->last->uri == "file:///b.mov");
  setup.events.clear();
  setup.output->last->now.load = ngn::VideoState::Load::Ready;
  first(Change::State);
  first(Change::Ended);
  CHECK(setup.events.empty());
  setup.output->last->report(Change::State);
  CHECK(types(setup.events) == std::vector<std::string>{"statusChange", "sourceLoad"});
}

TEST_CASE("NgNativeVideo plays, pauses, seeks and replays on the player, and sends playToEnd, looping when asked") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///clip.mov"));
  auto &log = setup.output->log->calls;
  log.clear();
  setup.call("setPlaybackRate", dynamic::array(id, 1.5));
  setup.call("play", dynamic::array(id));
  setup.call("pause", dynamic::array(id));
  setup.output->last->now.currentTime = 1;
  setup.call("seekBy", dynamic::array(id, 0.5));
  setup.call("seekBy", dynamic::array(id, -9));
  setup.call("setCurrentTime", dynamic::array(id, 2));
  setup.call("replay", dynamic::array(id));
  CHECK(log == std::vector<std::string>{"rate 1.5", "play 1.5", "pause", "seek 1.5", "seek 0.0", "seek 2.0", "seek 0.0", "play 1.5"});

  // Not looping: playToEnd, and the player stays at the end.
  setup.events.clear();
  log.clear();
  setup.output->last->report(Change::Ended);
  CHECK(types(setup.events) == std::vector<std::string>{"playToEnd"});
  CHECK(log.empty());

  setup.call("setLoop", dynamic::array(id, true));
  CHECK(setup.call("state", dynamic::array(id))["loop"] == true);
  setup.events.clear();
  setup.output->last->report(Change::Ended);
  CHECK(types(setup.events) == std::vector<std::string>{"playToEnd"});
  CHECK(log == std::vector<std::string>{"seek 0.0", "play 1.5"});
}

TEST_CASE("NgNativeVideo sends each setter's change event with its old value, only when it changes") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///clip.mov"));
  setup.events.clear();
  setup.call("setVolume", dynamic::array(id, 0.25));
  setup.call("setVolume", dynamic::array(id, 0.25));
  setup.call("setVolume", dynamic::array(id, 7));
  setup.call("setMuted", dynamic::array(id, true));
  setup.call("setMuted", dynamic::array(id, true));
  setup.call("setPlaybackRate", dynamic::array(id, 2));
  setup.call("setPlaybackRate", dynamic::array(id, 2));
  CHECK(types(setup.events) == std::vector<std::string>{"volumeChange", "volumeChange", "mutedChange", "playbackRateChange"});
  CHECK(setup.events[0]["payload"] == dynamic::object("volume", 0.25)("oldVolume", 1.0));
  CHECK(setup.events[1]["payload"] == dynamic::object("volume", 1.0)("oldVolume", 0.25));
  CHECK(setup.events[2]["payload"] == dynamic::object("muted", true)("oldMuted", false));
  CHECK(setup.events[3]["payload"] == dynamic::object("playbackRate", 2.0)("oldPlaybackRate", 1.0));
  CHECK(setup.output->last->volume == 1.0);
  CHECK(setup.output->last->muted);

  auto state = setup.call("state", dynamic::array(id));
  CHECK(state["volume"] == 1.0);
  CHECK(state["muted"] == true);
  CHECK(state["playbackRate"] == 2.0);

  // What was set before a source arrives reaches it.
  setup.call("replace", dynamic::array(id, "file:///b.mov"));
  CHECK(setup.output->last->muted);
  setup.call("setPreservesPitch", dynamic::array(id, false));
  CHECK(setup.output->log->calls.back() == "pitch varies");
  CHECK(setup.call("state", dynamic::array(id))["preservesPitch"] == false);
}

TEST_CASE("NgNativeVideo sends timeUpdate only with an interval, with the position and what is buffered") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///clip.mov"));
  setup.output->last->now.currentTime = 0.5;
  setup.output->last->now.bufferedPosition = 2;
  setup.events.clear();
  setup.output->last->report(Change::Time);
  CHECK(setup.events.empty());

  setup.call("setTimeUpdateEventInterval", dynamic::array(id, 0.25));
  CHECK(setup.output->last->interval == 0.25);
  CHECK(setup.call("state", dynamic::array(id))["timeUpdateEventInterval"] == 0.25);
  setup.output->last->report(Change::Time);
  REQUIRE(setup.events.size() == 1);
  CHECK(setup.events[0]["type"] == "timeUpdate");
  CHECK(setup.events[0]["payload"] ==
        dynamic::object("currentTime", 0.5)("currentLiveTimestamp", nullptr)("currentOffsetFromLive", nullptr)("bufferedPosition", 2.0));

  setup.call("setTimeUpdateEventInterval", dynamic::array(id, 0));
  CHECK(setup.output->last->interval == 0);
}

TEST_CASE("NgNativeVideo releases a player, and calls on an id it does not hold do nothing") {
  Setup setup;
  auto id = setup.call("createPlayer", dynamic::array("file:///clip.mov"));
  auto changed = setup.output->last->changed;
  auto other = setup.call("createPlayer", dynamic::array(nullptr));
  CHECK(other != id);
  setup.call("release", dynamic::array(id));
  CHECK(setup.output->log->destroyed == 1);
  setup.events.clear();
  changed(Change::Ended);
  setup.call("play", dynamic::array(id));
  setup.call("setVolume", dynamic::array(id, 0.5));
  CHECK(setup.call("state", dynamic::array(id)) == nullptr);
  CHECK(setup.call("state", dynamic::array("nope")) == nullptr);
  CHECK(setup.events.empty());

  setup.module.reset();
  CHECK(setup.output->log->destroyed == 2);
}

namespace {

ngn::VideoViewModel model(dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::VideoViewComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parserContext{1, *context};
  auto props = std::static_pointer_cast<const ngn::VideoViewProps>(descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw))));
  return ngn::videoViewModel(props->values);
}

} // namespace

TEST_CASE("The video view reads expo-video's iOS props, with its defaults") {
  CHECK(std::string(ngn::VideoViewComponentName) == "ViewManagerAdapter_ExpoVideo_VideoView");
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  CHECK(std::make_shared<ngn::MountingManager>(backend, backend)->hasComponent(ngn::VideoViewComponentName));
  CHECK(model(dynamic::object()) == ngn::VideoViewModel{});
  auto set = model(dynamic::object("player", 3)("nativeControls", false)("contentFit", "cover")(
      "fullscreenOptions", dynamic::object("enable", false))("allowsPictureInPicture", true)("showsTimecodes", false)(
      "allowsVideoFrameAnalysis", false));
  CHECK(set.player == 3);
  CHECK_FALSE(set.nativeControls);
  CHECK(set.contentFit == ngn::VideoViewModel::Fit::Cover);
  CHECK_FALSE(set.fullscreen);
  CHECK(set.pictureInPicture);
  CHECK_FALSE(set.timecodes);
  CHECK_FALSE(set.frameAnalysis);
  CHECK(model(dynamic::object("contentFit", "fill")).contentFit == ngn::VideoViewModel::Fit::Fill);
  CHECK(model(dynamic::object("contentFit", "scale-down")).contentFit == ngn::VideoViewModel::Fit::Contain);
  // A player given as the object rather than its id draws nothing, as on iOS.
  CHECK(model(dynamic::object("player", dynamic::object("id", 3))).player == std::nullopt);
  CHECK(model(dynamic::object("fullscreenOptions", dynamic::object())).fullscreen);
}

TEST_CASE("The video view's props drop a value committed as null") {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::VideoViewComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parserContext{1, *context};
  auto first = descriptor.cloneProps(parserContext, nullptr, RawProps(dynamic::object("player", 4)("contentFit", "cover")));
  auto second = std::static_pointer_cast<const ngn::VideoViewProps>(
      descriptor.cloneProps(parserContext, first, RawProps(dynamic::object("player", nullptr))));
  auto shown = ngn::videoViewModel(second->values);
  CHECK(shown.player == std::nullopt);
  CHECK(shown.contentFit == ngn::VideoViewModel::Fit::Cover);
}
