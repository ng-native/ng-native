#include "ngn/audio.h"

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using folly::dynamic;

namespace {

struct FakeTrack final : ngn::AudioTrack {
  struct Log {
    std::vector<std::string> calls;
    double volume{1};
    double rate{1};
    int destroyed{0};
  };
  std::shared_ptr<Log> log;
  ngn::TrackState now;
  std::function<void()> pendingSeek;
  explicit FakeTrack(std::shared_ptr<Log> l) : log(std::move(l)) {}
  ~FakeTrack() override {
    log->destroyed++;
  }
  ngn::TrackState state() override {
    return now;
  }
  void play(double rate) override {
    log->calls.push_back("play " + std::to_string(rate).substr(0, 3));
    log->rate = rate;
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
    log->rate = rate;
  }
  void setVolume(double volume) override {
    log->volume = volume;
  }
};

struct FakeOutput final : ngn::AudioOutput {
  std::shared_ptr<FakeTrack::Log> log = std::make_shared<FakeTrack::Log>();
  FakeTrack *last{nullptr};
  std::string uri;
  double interval{0};
  std::function<void(Change)> changed;
  std::unique_ptr<ngn::AudioTrack> open(const std::string &u, double i, std::function<void(Change)> c) override {
    uri = u;
    interval = i;
    changed = std::move(c);
    auto track = std::make_unique<FakeTrack>(log);
    last = track.get();
    return track;
  }
};

struct FakeRecording final : ngn::AudioRecording {
  bool on{false};
  double seconds{0};
  bool record() override {
    on = true;
    return true;
  }
  void pause() override {
    on = false;
  }
  void stop() override {
    on = false;
  }
  bool recording() override {
    return on;
  }
  double currentTime() override {
    return seconds;
  }
  std::optional<double> metering() override {
    return -20.0;
  }
};

struct FakeInput final : ngn::AudioInput {
  Access now{Access::NotDetermined};
  Access decides{Access::Granted};
  bool microphone{true};
  int asked{0};
  std::string path;
  ngn::RecordingSettings settings;
  FakeRecording *last{nullptr};
  Access access() override {
    return now;
  }
  void requestAccess(std::function<void(Access)> done) override {
    asked++;
    now = decides;
    done(now);
  }
  bool hasMicrophone() override {
    return microphone;
  }
  std::unique_ptr<ngn::AudioRecording> prepare(const std::string &p, const ngn::RecordingSettings &s, std::string &) override {
    path = p;
    settings = s;
    auto recording = std::make_unique<FakeRecording>();
    last = recording.get();
    return recording;
  }
};

struct Setup {
  std::shared_ptr<FakeOutput> output = std::make_shared<FakeOutput>();
  std::shared_ptr<FakeInput> input = std::make_shared<FakeInput>();
  std::shared_ptr<ngn::NativeModule> module;
  std::vector<dynamic> events;
  explicit Setup(bool noPrompts = false) {
    module = ngn::makeAudioModule(output, input, "/tmp/Audio", noPrompts);
    module->setEmitter([this](const std::string &event, dynamic body) {
      CHECK(event == "ngNativeAudio");
      events.push_back(std::move(body));
    });
  }
  dynamic call(const std::string &method, dynamic args) {
    return module->call(method, args);
  }
  dynamic ask(const std::string &method, dynamic args = dynamic::array()) {
    std::optional<dynamic> answer;
    std::optional<std::string> failure;
    module->callWithPromise(method, args, {.resolve = [&](dynamic v) { answer = v; }, .reject = [&](const std::string &m) { failure = m; }});
    if (failure) {
      return dynamic::object("rejected", *failure);
    }
    REQUIRE(answer);
    return *answer;
  }
  dynamic lastStatus() {
    REQUIRE_FALSE(events.empty());
    return events.back()["status"];
  }
};

} // namespace

TEST_CASE("NgNativeAudio opens a player's source at its update interval, and answers expo-audio's status") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 250));
  CHECK(id.isString());
  CHECK(s.output->uri == "file:///a.wav");
  CHECK(s.output->interval == doctest::Approx(0.25));
  auto status = s.call("status", dynamic::array(id));
  CHECK(status["id"] == id);
  CHECK(status["isLoaded"] == dynamic(false));
  CHECK(status["playbackState"] == dynamic("loading"));
  CHECK(status["error"] == dynamic(nullptr));

  s.output->last->now = {.load = ngn::TrackState::Load::Ready, .duration = 3};
  s.output->changed(ngn::AudioOutput::Change::State);
  REQUIRE(s.events.size() == 1);
  CHECK(s.events[0]["type"] == dynamic("playbackStatusUpdate"));
  CHECK(s.events[0]["id"] == id);
  auto loaded = s.lastStatus();
  CHECK(loaded["isLoaded"] == dynamic(true));
  CHECK(loaded["playbackState"] == dynamic("readyToPlay"));
  CHECK(loaded["duration"] == dynamic(3.0));
  CHECK(loaded["playing"] == dynamic(false));
  CHECK(loaded["didJustFinish"] == dynamic(false));
  CHECK(loaded["playbackRate"] == dynamic(1.0));
  CHECK(loaded["isLive"] == dynamic(false));
}

TEST_CASE("NgNativeAudio's default interval is expo-audio's 500 ms, and a null source opens nothing") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array(nullptr, nullptr));
  CHECK(s.output->last == nullptr);
  s.call("play", dynamic::array(id));
  CHECK(s.output->log->calls.empty());
  CHECK(s.call("status", dynamic::array(id))["isLoaded"] == dynamic(false));
  s.call("replace", dynamic::array(id, "file:///b.wav"));
  CHECK(s.output->uri == "file:///b.wav");
  CHECK(s.output->interval == doctest::Approx(0.5));
}

TEST_CASE("NgNativeAudio plays at the rate set, pauses, and reports a failure") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  s.call("setPlaybackRate", dynamic::array(id, 1.5));
  CHECK(s.output->log->calls.empty());
  s.call("play", dynamic::array(id));
  CHECK(s.output->log->calls.back() == "play 1.5");
  CHECK(s.lastStatus()["playing"] == dynamic(true));
  CHECK(s.lastStatus()["playbackRate"] == dynamic(1.5));
  // While it plays a new rate applies at once, held to expo-audio's 0 to 2.
  s.call("setPlaybackRate", dynamic::array(id, 9));
  CHECK(s.output->log->calls.back() == "rate 2.0");
  s.call("pause", dynamic::array(id));
  CHECK(s.output->log->calls.back() == "pause");
  CHECK(s.lastStatus()["playing"] == dynamic(false));
  CHECK(s.lastStatus()["timeControlStatus"] == dynamic("paused"));

  s.output->last->now.load = ngn::TrackState::Load::Failed;
  s.output->last->now.error = "The file is not audio";
  s.output->changed(ngn::AudioOutput::Change::State);
  CHECK(s.lastStatus()["error"] == dynamic("The file is not audio"));
  CHECK(s.lastStatus()["playbackState"] == dynamic("failed"));
  CHECK(s.lastStatus()["isLoaded"] == dynamic(false));
}

TEST_CASE("NgNativeAudio sets the volume a mute leaves, and the mute in the status") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  s.call("setVolume", dynamic::array(id, 0.4));
  CHECK(s.output->log->volume == doctest::Approx(0.4));
  s.call("setMuted", dynamic::array(id, true));
  CHECK(s.output->log->volume == 0);
  CHECK(s.call("status", dynamic::array(id))["mute"] == dynamic(true));
  s.call("setVolume", dynamic::array(id, 0.8));
  CHECK(s.output->log->volume == 0);
  s.call("setMuted", dynamic::array(id, false));
  CHECK(s.output->log->volume == doctest::Approx(0.8));
  s.call("setVolume", dynamic::array(id, 3));
  CHECK(s.output->log->volume == 1);
  // A replaced source keeps the player's volume.
  s.call("setVolume", dynamic::array(id, 0.3));
  s.call("replace", dynamic::array(id, "file:///b.wav"));
  CHECK(s.output->log->volume == doctest::Approx(0.3));
}

TEST_CASE("NgNativeAudio seeks and resolves once the track is there") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  std::optional<dynamic> done;
  s.module->callWithPromise("seekTo", dynamic::array(id, 1.5), {.resolve = [&](dynamic v) { done = v; }, .reject = {}});
  CHECK(s.output->log->calls.back() == "seek 1.5");
  CHECK_FALSE(done);
  s.output->last->pendingSeek();
  CHECK(done);
  CHECK(s.lastStatus()["currentTime"] == dynamic(1.5));
}

TEST_CASE("NgNativeAudio sends didJustFinish once at the end, and plays again from the start") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  auto &track = *s.output->last;
  track.now = {.load = ngn::TrackState::Load::Ready, .currentTime = 0, .duration = 2};
  s.call("play", dynamic::array(id));
  track.now.currentTime = 2;
  s.output->changed(ngn::AudioOutput::Change::Ended);
  CHECK(s.output->log->calls.back() == "pause");
  CHECK(s.lastStatus()["didJustFinish"] == dynamic(true));
  CHECK(s.lastStatus()["playing"] == dynamic(false));
  s.output->changed(ngn::AudioOutput::Change::State);
  CHECK(s.lastStatus()["didJustFinish"] == dynamic(false));
  s.output->log->calls.clear();
  s.call("play", dynamic::array(id));
  REQUIRE(s.output->log->calls.size() == 2);
  CHECK(s.output->log->calls[0] == "seek 0.0");
  CHECK(s.output->log->calls[1] == "play 1.0");
}

TEST_CASE("NgNativeAudio starts a looping player over at the end") {
  Setup s;
  auto id = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  auto &track = *s.output->last;
  track.now = {.load = ngn::TrackState::Load::Ready, .duration = 2};
  s.call("setLoop", dynamic::array(id, true));
  CHECK(s.call("status", dynamic::array(id))["loop"] == dynamic(true));
  s.call("play", dynamic::array(id));
  s.output->log->calls.clear();
  track.now.playing = false;
  s.output->changed(ngn::AudioOutput::Change::Ended);
  REQUIRE(s.output->log->calls.size() == 2);
  CHECK(s.output->log->calls[0] == "seek 0.0");
  CHECK(s.output->log->calls[1] == "play 1.0");
  CHECK(s.lastStatus()["didJustFinish"] == dynamic(true));
  CHECK(s.lastStatus()["playing"] == dynamic(true));
}

TEST_CASE("NgNativeAudio releases a player's track, on release and when a reload ends the module") {
  Setup s;
  auto a = s.call("createPlayer", dynamic::array("file:///a.wav", 500));
  s.call("createPlayer", dynamic::array("file:///b.wav", 500));
  s.call("release", dynamic::array(a));
  CHECK(s.output->log->destroyed == 1);
  CHECK(s.call("status", dynamic::array(a)) == dynamic(nullptr));
  // A call on a released player does nothing.
  s.call("play", dynamic::array(a));
  auto log = s.output->log;
  auto changed = s.output->changed;
  s.module.reset();
  CHECK(log->destroyed == 2);
  // A change the OS sends after the module is gone goes nowhere.
  s.events.clear();
  changed(ngn::AudioOutput::Change::State);
  CHECK(s.events.empty());
}

TEST_CASE("NgNativeAudio reads expo-audio's recording options with the ios ones merged") {
  auto defaults = ngn::recordingSettingsOf(dynamic::object());
  CHECK(defaults == ngn::RecordingSettings{});
  auto high = ngn::recordingSettingsOf(dynamic::object("extension", ".m4a")("sampleRate", 48000)("numberOfChannels", 1)(
      "bitRate", 64000)("isMeteringEnabled", true)("audioQuality", 96)("outputFormat", "aac "));
  CHECK(high.format == "aac");
  CHECK(high.sampleRate == 48000);
  CHECK(high.channels == 1);
  CHECK(high.bitRate == 64000);
  CHECK(high.quality == 96);
  CHECK(high.metering);
  auto wav = ngn::recordingSettingsOf(dynamic::object("extension", ".wav")("outputFormat", "lpcm")("linearPCMBitDepth", 24));
  CHECK(wav.format == "pcm");
  CHECK(wav.bitDepth == 24);
  // A PCM extension with no format is PCM; Apple Lossless by its code.
  CHECK(ngn::recordingSettingsOf(dynamic::object("extension", ".caf")).format == "pcm");
  CHECK(ngn::recordingSettingsOf(dynamic::object("extension", ".m4a")("outputFormat", "alac")).format == "alac");
  // A number is a CoreAudio format id: 'lpcm' is 1819304813.
  CHECK(ngn::recordingSettingsOf(dynamic::object("outputFormat", 1819304813)).format == "pcm");
}

TEST_CASE("NgNativeAudio's microphone permission asks only what is undetermined, never with no prompts") {
  {
    Setup s;
    auto before = s.ask("getRecordingPermissionsAsync");
    CHECK(before["status"] == dynamic("undetermined"));
    CHECK(before["canAskAgain"] == dynamic(true));
    auto granted = s.ask("requestRecordingPermissionsAsync");
    CHECK(granted["status"] == dynamic("granted"));
    CHECK(granted["granted"] == dynamic(true));
    CHECK(s.input->asked == 1);
    s.ask("requestRecordingPermissionsAsync");
    CHECK(s.input->asked == 1);
  }
  {
    Setup s(true);
    auto answer = s.ask("requestRecordingPermissionsAsync");
    CHECK(answer["status"] == dynamic("undetermined"));
    CHECK(s.input->asked == 0);
  }
  {
    Setup s;
    s.input->now = ngn::AudioInput::Access::Denied;
    auto denied = s.ask("requestRecordingPermissionsAsync");
    CHECK(denied["status"] == dynamic("denied"));
    CHECK(denied["canAskAgain"] == dynamic(false));
    CHECK(s.input->asked == 0);
  }
}

TEST_CASE("NgNativeAudio refuses to prepare a recorder without the permission, or with no microphone") {
  Setup s;
  auto id = s.call("createRecorder", dynamic::array(dynamic::object("extension", ".m4a")));
  s.input->now = ngn::AudioInput::Access::Denied;
  auto denied = s.ask("prepareToRecordAsync", dynamic::array(id, nullptr));
  REQUIRE(denied.count("rejected"));
  CHECK(denied["rejected"].asString().find("permission") != std::string::npos);
  CHECK(s.input->last == nullptr);
  auto status = s.call("recorderStatus", dynamic::array(id));
  CHECK(status["canRecord"] == dynamic(false));
  CHECK(status["isRecording"] == dynamic(false));
  CHECK(status["url"] == dynamic(nullptr));
  // record() before a prepare does nothing.
  s.call("record", dynamic::array(id));
  CHECK(s.call("recorderStatus", dynamic::array(id))["isRecording"] == dynamic(false));

  s.input->now = ngn::AudioInput::Access::Granted;
  s.input->microphone = false;
  auto absent = s.ask("prepareToRecordAsync", dynamic::array(id, nullptr));
  REQUIRE(absent.count("rejected"));
  CHECK(absent["rejected"].asString().find("microphone") != std::string::npos);
  CHECK(s.input->last == nullptr);
}

TEST_CASE("NgNativeAudio records with the permission, into a file under its folder") {
  Setup s;
  s.input->now = ngn::AudioInput::Access::Granted;
  auto id = s.call("createRecorder", dynamic::array(dynamic::object("extension", ".m4a")("isMeteringEnabled", true)));
  CHECK(s.ask("prepareToRecordAsync", dynamic::array(id, nullptr)) == dynamic(nullptr));
  REQUIRE(s.input->last != nullptr);
  CHECK(s.input->path.rfind("/tmp/Audio/recording-", 0) == 0);
  CHECK(s.input->path.size() > 4);
  CHECK(s.input->path.substr(s.input->path.size() - 4) == ".m4a");
  CHECK(s.input->settings.metering);
  auto ready = s.call("recorderStatus", dynamic::array(id));
  CHECK(ready["canRecord"] == dynamic(true));
  CHECK(ready["url"] == dynamic("file://" + s.input->path));

  s.call("record", dynamic::array(id));
  s.input->last->seconds = 1.25;
  auto recording = s.call("recorderStatus", dynamic::array(id));
  CHECK(recording["isRecording"] == dynamic(true));
  CHECK(recording["durationMillis"] == dynamic(1250.0));
  CHECK(recording["metering"] == dynamic(-20.0));
  CHECK(recording["mediaServicesDidReset"] == dynamic(false));

  s.ask("stopRecording", dynamic::array(id));
  REQUIRE_FALSE(s.events.empty());
  CHECK(s.events.back()["type"] == dynamic("recordingStatusUpdate"));
  CHECK(s.events.back()["id"] == id);
  CHECK(s.events.back()["status"]["isFinished"] == dynamic(true));
  CHECK(s.events.back()["status"]["url"] == dynamic("file://" + s.input->path));
  CHECK(s.call("recorderStatus", dynamic::array(id))["isRecording"] == dynamic(false));

  // A prepare's own options win over the recorder's.
  s.ask("prepareToRecordAsync", dynamic::array(id, dynamic::object("extension", ".wav")));
  CHECK(s.input->settings.format == "pcm");
  CHECK(s.input->path.substr(s.input->path.size() - 4) == ".wav");
}

TEST_CASE("NgNativeAudio's audio mode and session calls resolve with nothing to set") {
  Setup s;
  CHECK(s.ask("setAudioModeAsync", dynamic::array(dynamic::object("playsInSilentMode", true))) == dynamic(nullptr));
  CHECK(s.ask("setIsAudioActiveAsync", dynamic::array(true)) == dynamic(nullptr));
}
