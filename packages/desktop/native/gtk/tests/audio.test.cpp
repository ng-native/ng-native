// NgNativeAudio on Linux: expo-audio's players and recorders through the core's module, over
// GStreamer. Played into a fake sink on the pipeline's clock and recorded from a test tone, so no
// sound server is needed; what reaches PulseAudio and PipeWire is the media spike's to show.
#if NGN_GSTREAMER
#include "../audio.h"
#include "../gst-playback.h"
#include "helpers.h"
#include "mounted-views.h"

#include "ngn/file-system.h"

#include <doctest/doctest.h>
#include <gst/pbutils/pbutils.h>

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

using folly::dynamic;

namespace {

struct Folder {
  // With a space, as a home folder's name can have.
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn audio-" + std::to_string(getpid()));
  Folder() { std::filesystem::create_directories(path); }
  ~Folder() {
    std::error_code ignored;
    std::filesystem::remove_all(path, ignored);
  }
};

// Runs a gst-launch line to its end: a file made for a test, at `path` on its element named file,
// so the path is never parsed as part of the line.
void runPipeline(const std::string &line, const std::string &path) {
  REQUIRE(ngn::gtk::gstreamerHas({}));
  GError *error = nullptr;
  GstElement *pipeline = gst_parse_launch(line.c_str(), &error);
  REQUIRE_MESSAGE(error == nullptr, (error ? error->message : ""));
  GstElement *file = gst_bin_get_by_name(GST_BIN(pipeline), "file");
  REQUIRE(file);
  g_object_set(file, "location", path.c_str(), nullptr);
  gst_object_unref(file);
  gst_element_set_state(pipeline, GST_STATE_PLAYING);
  GstBus *bus = gst_element_get_bus(pipeline);
  GstMessage *end = gst_bus_timed_pop_filtered(bus, 10 * GST_SECOND, static_cast<GstMessageType>(GST_MESSAGE_EOS | GST_MESSAGE_ERROR));
  bool ended = end && GST_MESSAGE_TYPE(end) == GST_MESSAGE_EOS;
  if (end) {
    gst_message_unref(end);
  }
  gst_object_unref(bus);
  gst_element_set_state(pipeline, GST_STATE_NULL);
  gst_object_unref(pipeline);
  REQUIRE(ended);
}

// A WAV of a 440 Hz tone, `tenths` tenths of a second long.
std::string toneFile(const Folder &folder, const char *name, int tenths) {
  auto path = (folder.path / name).string();
  runPipeline("audiotestsrc num-buffers=" + std::to_string(tenths) +
              " samplesperbuffer=4800 ! audio/x-raw,rate=48000,channels=1 ! wavenc ! filesink name=file", path);
  return path;
}

// What GStreamer's discoverer reads in a file: its length in seconds and its first audio stream's
// caps, or nothing for a file it cannot read.
struct Discovered {
  double seconds{0};
  std::string caps;
  unsigned rate{0}, channels{0}, depth{0};
};
std::optional<Discovered> discover(const std::string &path) {
  GstDiscoverer *discoverer = gst_discoverer_new(5 * GST_SECOND, nullptr);
  gchar *uri = g_filename_to_uri(path.c_str(), nullptr, nullptr);
  GstDiscovererInfo *info = gst_discoverer_discover_uri(discoverer, uri, nullptr);
  g_free(uri);
  std::optional<Discovered> out;
  if (info && gst_discoverer_info_get_result(info) == GST_DISCOVERER_OK) {
    out = Discovered{.seconds = static_cast<double>(gst_discoverer_info_get_duration(info)) / GST_SECOND};
    GList *streams = gst_discoverer_info_get_audio_streams(info);
    if (streams) {
      GstCaps *caps = gst_discoverer_stream_info_get_caps(GST_DISCOVERER_STREAM_INFO(streams->data));
      gchar *text = gst_caps_to_string(caps);
      out->caps = text;
      g_free(text);
      gst_caps_unref(caps);
      auto *audio = GST_DISCOVERER_AUDIO_INFO(streams->data);
      out->rate = gst_discoverer_audio_info_get_sample_rate(audio);
      out->channels = gst_discoverer_audio_info_get_channels(audio);
      out->depth = gst_discoverer_audio_info_get_depth(audio);
    }
    gst_discoverer_stream_info_list_free(streams);
  }
  if (info) {
    g_object_unref(info);
  }
  g_object_unref(discoverer);
  return out;
}

// The path of a file: url, its escapes undone.
std::string pathOf(const std::string &uri) {
  gchar *path = g_filename_from_uri(uri.c_str(), nullptr, nullptr);
  REQUIRE_MESSAGE(path, uri);
  std::string out = path;
  g_free(path);
  return out;
}

// Whether a promise's answer is a rejection.
bool rejected(const dynamic &answer) {
  return answer.isObject() && answer.count("rejected");
}

// Three frames of red, 16 by 16, in H.264 in MPEG-4: el9's own plugins have no H.264 decoder.
constexpr const char *kTinyH264 =
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMKbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAASwAAQAAAQAA"
    "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA"
    "All0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAASwAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA"
    "AAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAEsAAAAAAABAAAAAAHRbWRpYQAAACBtZGhk"
    "AAAAAAAAAAAAAAAAAAAoAAAADABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABfG1p"
    "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATxzdGJsAAAAuHN0c2QA"
    "AAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMAUDxImSABAAVoy4PLIAAAABBwYXNwAAAA"
    "AQAAAAEAAAAUYnRydAAAAAAAAEXlAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAAEAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0"
    "c2MAAAAAAAAAAQAAAAEAAAADAAAAAQAAACBzdHN6AAAAAAAAAAAAAAADAAACjAAAAAkAAAAKAAAAFHN0Y28AAAAAAAAAAQAAAzoA"
    "AAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAAKnbWRh"
    "dAAAAnEGBf//bdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMg"
    "Y29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBj"
    "YWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEu"
    "MDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpv"
    "bmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xp"
    "Y2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRy"
    "YT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9"
    "MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0"
    "ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAE2WIhA/xGKAAJvscAARwY4AAq5YAAAAFQZo4HeoAAAAGQZpUBvqA";

struct Module {
  std::shared_ptr<ngn::NativeModule> module;
  std::vector<dynamic> events;
  Module(const Folder &folder, ngn::gtk::AudioInputSetup input = {.source = "audiotestsrc is-live=true", .microphone = [] { return true; }}) {
    REQUIRE(ngn::testing::gtkReady());
    auto output = ngn::gtk::makeAudioOutput("fakesink");
    REQUIRE(output);
    module = ngn::makeAudioModule(output, ngn::gtk::makeAudioInput(std::move(input)), (folder.path / "Audio").string(), true,
                                  ngn::testing::readsEverywhere());
    module->setEmitter([this](const std::string &, dynamic body) { events.push_back(std::move(body)); });
  }
  dynamic call(const std::string &method, dynamic args) { return module->call(method, args); }
  // A promise's answer once the main loop has given it; a rejection as {rejected: message}.
  dynamic ask(const std::string &method, dynamic args) {
    // Shared with the callbacks, which may come after a wait that gave up.
    auto answer = std::make_shared<std::optional<dynamic>>();
    module->callWithPromise(method, args,
                            {.resolve = [answer](dynamic v) { *answer = v; },
                             .reject = [answer](const std::string &m) { *answer = dynamic::object("rejected", m); }});
    ngn::testing::runUntil([&] { return answer->has_value(); });
    return **answer;
  }
  dynamic status(const dynamic &id) { return call("status", dynamic::array(id)); }
  bool finished() {
    for (auto &event : events) {
      if (event["type"] == "playbackStatusUpdate" && event["status"]["didJustFinish"] == true) {
        return true;
      }
    }
    return false;
  }
};

} // namespace

TEST_CASE("Audio on Linux loads a file, plays it at its rate to the end once, and stays there") {
  Folder folder;
  auto wav = toneFile(folder, "tone.wav", 6);
  Module m(folder);
  auto id = m.call("createPlayer", dynamic::array(ngn::fileUri(wav), 100));
  ngn::testing::runUntil([&] { return m.status(id)["isLoaded"] == true; });
  auto loaded = m.status(id);
  CHECK(loaded["playbackState"] == "readyToPlay");
  CHECK(loaded["duration"].asDouble() == doctest::Approx(0.6).epsilon(0.05));
  CHECK(loaded["playing"] == false);

  gint64 started = g_get_monotonic_time();
  m.call("play", dynamic::array(id));
  CHECK(m.status(id)["playing"] == true);
  ngn::testing::runUntil([&] { return m.finished(); });
  // Played on the clock: at about its own length, not as fast as it decodes.
  double took = static_cast<double>(g_get_monotonic_time() - started) / G_USEC_PER_SEC;
  CHECK(took > 0.5);
  auto ended = m.status(id);
  CHECK(ended["playing"] == false);
  CHECK(ended["currentTime"].asDouble() == doctest::Approx(0.6).epsilon(0.05));
  // Interval updates came while it played.
  size_t updates = 0;
  for (auto &event : m.events) {
    updates += event["type"] == "playbackStatusUpdate" && event["status"]["playing"] == true;
  }
  CHECK(updates >= 3);
}

TEST_CASE("Audio on Linux seeks a paused file, answering once the position is there, and plays again from the start after its end") {
  Folder folder;
  auto wav = toneFile(folder, "tone.wav", 10);
  Module m(folder);
  auto id = m.call("createPlayer", dynamic::array(ngn::fileUri(wav), 100));
  // Asked before the file has loaded: it seeks once it has.
  auto seeked = m.ask("seekTo", dynamic::array(id, 0.7));
  CHECK_FALSE(seeked.isObject());
  CHECK(m.status(id)["currentTime"].asDouble() == doctest::Approx(0.7).epsilon(0.05));

  m.call("play", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.finished(); });
  m.events.clear();
  m.call("play", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.status(id)["currentTime"].asDouble() > 0.05 && m.status(id)["currentTime"].asDouble() < 0.5; });
  CHECK(m.status(id)["playing"] == true);
  m.call("pause", dynamic::array(id));
  CHECK(m.status(id)["playing"] == false);
}

TEST_CASE("Audio on Linux loops a looping player at its end") {
  Folder folder;
  auto wav = toneFile(folder, "tone.wav", 3);
  Module m(folder);
  auto id = m.call("createPlayer", dynamic::array(ngn::fileUri(wav), 100));
  m.call("setLoop", dynamic::array(id, true));
  m.call("play", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.finished(); });
  ngn::testing::runUntil([&] {
    double at = m.status(id)["currentTime"].asDouble();
    return at > 0.02 && at < 0.25;
  });
  CHECK(m.status(id)["playing"] == true);
}

TEST_CASE("Audio on Linux fails a file it cannot read, and one no decoder is installed for, with why") {
  Folder folder;
  auto junk = (folder.path / "junk.mp3").string();
  g_file_set_contents(junk.c_str(), "not audio at all", -1, nullptr);
  auto h264 = (folder.path / "h264.mp4").string();
  gsize size = 0;
  guchar *bytes = g_base64_decode(kTinyH264, &size);
  g_file_set_contents(h264.c_str(), reinterpret_cast<const gchar *>(bytes), static_cast<gssize>(size), nullptr);
  g_free(bytes);
  Module m(folder);
  auto bad = m.call("createPlayer", dynamic::array(ngn::fileUri(junk), 100));
  ngn::testing::runUntil([&] { return m.status(bad)["playbackState"] == "failed"; });
  CHECK(m.status(bad)["error"].isString());
  CHECK(m.status(bad)["isLoaded"] == false);
  if (ngn::gtk::gstreamerHas({"openh264dec"}) || ngn::gtk::gstreamerHas({"avdec_h264"})) {
    MESSAGE("an H.264 decoder is installed: the missing decoder case is not run");
    return;
  }
  // An audio player plays no video: a playback with a video sink hears that it has no decoder for it.
  ngn::gtk::Playback playback(ngn::fileUri(h264), {.audioSink = "fakesink", .videoSink = gst_element_factory_make("fakesink", nullptr)},
                              [](ngn::gtk::Playback::Change) {});
  ngn::testing::runUntil([&] { return playback.state().load == ngn::gtk::PlaybackState::Load::Failed; });
  CHECK(playback.state().error.find("No decoder is installed for H.264") == 0);
  playback.play(1);
  CHECK_FALSE(playback.state().playing);
}

TEST_CASE("Audio on Linux records AAC in MPEG-4 at the settings asked, pauses without the pause in the file, and meters") {
  Folder folder;
  Module m(folder);
  CHECK(m.ask("getRecordingPermissionsAsync", dynamic::array())["granted"] == true);
  auto id = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".m4a")("sampleRate", 22050)("numberOfChannels", 1)(
      "bitRate", 64000)("isMeteringEnabled", true)));
  CHECK_FALSE(rejected(m.ask("prepareToRecordAsync", dynamic::array(id))));
  m.call("record", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.call("recorderStatus", dynamic::array(id))["durationMillis"].asDouble() >= 400; });
  auto recording = m.call("recorderStatus", dynamic::array(id));
  CHECK(recording["isRecording"] == true);
  CHECK(recording["metering"].asDouble() > -60);
  m.call("pauseRecording", dynamic::array(id));
  double paused = m.call("recorderStatus", dynamic::array(id))["durationMillis"].asDouble();
  g_usleep(400 * 1000);
  CHECK(m.call("recorderStatus", dynamic::array(id))["durationMillis"].asDouble() == doctest::Approx(paused).epsilon(0.02));
  m.call("record", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.call("recorderStatus", dynamic::array(id))["durationMillis"].asDouble() >= paused + 300; });
  auto stopped = m.ask("stopRecording", dynamic::array(id));
  CHECK_FALSE(rejected(stopped));
  auto status = m.call("recorderStatus", dynamic::array(id));
  CHECK(status["isRecording"] == false);
  std::string url = status["url"].asString();
  REQUIRE(url.rfind("file://", 0) == 0);
  auto found = discover(pathOf(url));
  REQUIRE(found);
  CHECK(found->caps.find("audio/mpeg") == 0);
  CHECK(found->rate == 22050);
  CHECK(found->channels == 1);
  // The paused 400 ms is not in it.
  CHECK(found->seconds == doctest::Approx(status["durationMillis"].asDouble() / 1000).epsilon(0.15));
  CHECK(found->seconds < 1.3);
}

TEST_CASE("Audio on Linux records linear PCM into WAV, and refuses an extension it has no muxer for") {
  Folder folder;
  Module m(folder);
  auto id = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".wav")("sampleRate", 16000)("numberOfChannels", 1)));
  REQUIRE_FALSE(rejected(m.ask("prepareToRecordAsync", dynamic::array(id))));
  m.call("record", dynamic::array(id));
  ngn::testing::runUntil([&] { return m.call("recorderStatus", dynamic::array(id))["durationMillis"].asDouble() >= 300; });
  m.ask("stopRecording", dynamic::array(id));
  auto found = discover(pathOf(m.call("recorderStatus", dynamic::array(id))["url"].asString()));
  REQUIRE(found);
  // The discoverer names a WAV's stream by its container.
  CHECK(found->caps.find("audio/x-wav") == 0);
  CHECK(found->depth == 16);
  CHECK(found->rate == 16000);
  CHECK(found->channels == 1);

  auto caf = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".caf")));
  auto refused = m.ask("prepareToRecordAsync", dynamic::array(caf));
  CHECK(refused["rejected"].asString().find("cannot record linear PCM into a .caf file") != std::string::npos);
}

TEST_CASE("Audio on Linux refuses to prepare a recording with no microphone") {
  Folder folder;
  Module m(folder, {.source = "audiotestsrc is-live=true", .microphone = [] { return false; }});
  auto id = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".m4a")));
  auto refused = m.ask("prepareToRecordAsync", dynamic::array(id));
  CHECK(refused["rejected"].asString().find("has no microphone") != std::string::npos);
}

TEST_CASE("Audio on Linux counts a listed source as a microphone, but not an output's monitor") {
  REQUIRE(ngn::gtk::gstreamerHas({}));
  auto check = [](const char *description) {
    GstStructure *properties = description ? gst_structure_from_string(description, nullptr) : nullptr;
    bool out = ngn::gtk::isMicrophone(properties);
    if (properties) {
      gst_structure_free(properties);
    }
    return out;
  };
  CHECK(check("properties, device.class=(string)sound, device.api=(string)alsa"));
  CHECK(check("properties, media.class=(string)Audio/Source"));
  CHECK(check(nullptr));
  CHECK_FALSE(check("properties, device.class=(string)monitor"));
}

TEST_CASE("Audio on Linux pauses a playing file whose rate is set to 0") {
  Folder folder;
  auto wav = toneFile(folder, "tone.wav", 20);
  Module m(folder);
  auto id = m.call("createPlayer", dynamic::array(ngn::fileUri(wav), 100));
  ngn::testing::runUntil([&] { return m.status(id)["isLoaded"] == true; });
  m.call("play", dynamic::array(id));
  CHECK(m.status(id)["playing"] == true);
  m.call("setPlaybackRate", dynamic::array(id, 0));
  CHECK(m.status(id)["playing"] == false);
}

TEST_CASE("Audio on Linux seeks a player whose rate is 0") {
  Folder folder;
  auto wav = toneFile(folder, "tone.wav", 20);
  Module m(folder);
  auto id = m.call("createPlayer", dynamic::array(ngn::fileUri(wav), 100));
  ngn::testing::runUntil([&] { return m.status(id)["isLoaded"] == true; });
  m.call("play", dynamic::array(id));
  m.call("setPlaybackRate", dynamic::array(id, 0));
  auto seeked = m.ask("seekTo", dynamic::array(id, 1.2));
  CHECK_FALSE(rejected(seeked));
  CHECK(m.status(id)["currentTime"].asDouble() == doctest::Approx(1.2).epsilon(0.05));
  CHECK(m.status(id)["playing"] == false);
}

TEST_CASE("Audio on Linux records Opus in Ogg at its nearest rate, and PCM in AIFF big-endian") {
  Folder folder;
  Module m(folder);
  // expo-audio's default 44.1 kHz, which Opus does not take.
  auto ogg = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".ogg")("sampleRate", 44100)("numberOfChannels", 1)));
  REQUIRE_FALSE(rejected(m.ask("prepareToRecordAsync", dynamic::array(ogg))));
  m.call("record", dynamic::array(ogg));
  ngn::testing::runUntil([&] { return m.call("recorderStatus", dynamic::array(ogg))["durationMillis"].asDouble() >= 300; });
  m.ask("stopRecording", dynamic::array(ogg));
  CHECK(m.events.back()["status"]["hasError"] == false);
  auto opus = discover(pathOf(m.call("recorderStatus", dynamic::array(ogg))["url"].asString()));
  REQUIRE(opus);
  CHECK(opus->caps.find("audio/x-opus") == 0);
  CHECK(opus->seconds > 0.2);

  if (!ngn::gtk::gstreamerHas({"aiffmux"})) {
    MESSAGE("no aiffmux installed: AIFF skipped");
    return;
  }
  auto aif = m.call("createRecorder", dynamic::array(dynamic::object("extension", ".aif")("sampleRate", 16000)("numberOfChannels", 1)));
  REQUIRE_FALSE(rejected(m.ask("prepareToRecordAsync", dynamic::array(aif))));
  m.call("record", dynamic::array(aif));
  ngn::testing::runUntil([&] { return m.call("recorderStatus", dynamic::array(aif))["durationMillis"].asDouble() >= 300; });
  m.ask("stopRecording", dynamic::array(aif));
  CHECK(m.events.back()["status"]["hasError"] == false);
  auto pcm = discover(pathOf(m.call("recorderStatus", dynamic::array(aif))["url"].asString()));
  REQUIRE(pcm);
  CHECK(pcm->depth == 16);
  CHECK(pcm->rate == 16000);
}

TEST_CASE("Audio on Linux picks an encoder and muxer by the recording's extension and format") {
  REQUIRE(ngn::gtk::gstreamerHas({}));
  ngn::RecordingSettings aac;
  aac.bitRate = 96000;
  auto m4a = ngn::gtk::recordingElementsOf(aac);
  CHECK(m4a.error.empty());
  CHECK(m4a.muxer == "mp4mux");
  CHECK(m4a.encoder.find(" bitrate=96000") != std::string::npos);
  ngn::RecordingSettings ogg;
  ogg.extension = ".ogg";
  CHECK(ngn::gtk::recordingElementsOf(ogg).muxer == "oggmux");
  CHECK(ngn::gtk::recordingElementsOf(ogg).encoder.rfind("opusenc", 0) == 0);
  CHECK(ngn::gtk::recordingRateOf(ogg, ngn::gtk::recordingElementsOf(ogg)) == 48000);
  ogg.sampleRate = 16000;
  CHECK(ngn::gtk::recordingRateOf(ogg, ngn::gtk::recordingElementsOf(ogg)) == 16000);
  ogg.sampleRate = 22050;
  CHECK(ngn::gtk::recordingRateOf(ogg, ngn::gtk::recordingElementsOf(ogg)) == 24000);
  aac.sampleRate = 22050;
  CHECK(ngn::gtk::recordingRateOf(aac, m4a) == 22050);
  ngn::RecordingSettings flac;
  flac.extension = ".flac";
  CHECK(ngn::gtk::recordingElementsOf(flac).error.find("cannot record into a .flac file") != std::string::npos);
}
#endif
