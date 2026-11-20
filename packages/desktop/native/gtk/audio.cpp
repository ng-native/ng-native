#include "audio.h"

#include "gst-playback.h"

#include <glib/gstdio.h>

#include <atomic>
#include <cmath>
#include <mutex>

namespace ngn::gtk {

namespace {

using Change = AudioOutput::Change;

class GstTrack final : public AudioTrack {
 public:
  GstTrack(const std::string &uri, const std::string &sink, double interval, std::function<void(Change)> changed)
      : playback_(uri, {.audioSink = sink, .interval = interval > 0 ? interval : 0.5}, [changed = std::move(changed)](Playback::Change change) {
          changed(change == Playback::Change::Ended ? Change::Ended : Change::State);
        }) {}

  TrackState state() override {
    auto now = playback_.state();
    TrackState out;
    out.load = now.load == PlaybackState::Load::Ready    ? TrackState::Load::Ready
               : now.load == PlaybackState::Load::Failed ? TrackState::Load::Failed
                                                         : TrackState::Load::Loading;
    out.error = now.error;
    out.playing = now.playing;
    out.buffering = now.buffering;
    out.currentTime = now.currentTime;
    out.duration = now.duration;
    return out;
  }
  void play(double rate) override { playback_.play(rate); }
  void pause() override { playback_.pause(); }
  void seek(double seconds, std::function<void()> done) override { playback_.seek(seconds, std::move(done)); }
  void setRate(double rate) override { playback_.setRate(rate); }
  void setVolume(double volume) override { playback_.setVolume(volume); }

 private:
  Playback playback_;
};

class GstOutput final : public AudioOutput {
 public:
  explicit GstOutput(std::string sink) : sink_(std::move(sink)) {}
  std::unique_ptr<AudioTrack> open(const std::string &uri, double interval, std::function<void(Change)> changed) override {
    return std::make_unique<GstTrack>(uri, sink_, interval, std::move(changed));
  }

 private:
  std::string sink_;
};

// What the bus says while recording, kept by its sync handler on a streaming thread: the level's
// messages are read and dropped there, so a long recording queues none.
struct RecordingBus {
  std::atomic<double> rms{-160};
  std::mutex mutex;
  std::string error;
};

GstBusSyncReply onRecordingMessage(GstBus *, GstMessage *message, gpointer data) {
  auto *bus = static_cast<RecordingBus *>(data);
  if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ELEMENT) {
    const GstStructure *s = gst_message_get_structure(message);
    if (s && gst_structure_has_name(s, "level")) {
      // A GValueArray of one RMS per channel, in dBFS.
      const GValue *list = gst_structure_get_value(s, "rms");
      G_GNUC_BEGIN_IGNORE_DEPRECATIONS
      auto *channels = list && G_VALUE_HOLDS(list, G_TYPE_VALUE_ARRAY) ? static_cast<GValueArray *>(g_value_get_boxed(list)) : nullptr;
      if (channels && channels->n_values > 0) {
        double rms = g_value_get_double(g_value_array_get_nth(channels, 0));
        bus->rms = std::isfinite(rms) ? std::max(rms, -160.0) : -160.0;
      }
      G_GNUC_END_IGNORE_DEPRECATIONS
      gst_message_unref(message);
      return GST_BUS_DROP;
    }
  }
  if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
    GError *error = nullptr;
    gst_message_parse_error(message, &error, nullptr);
    std::lock_guard lock(bus->mutex);
    bus->error = error && error->message ? error->message : "the recording failed";
    if (error) {
      g_error_free(error);
    }
  }
  return GST_BUS_PASS;
}

class GstRecording final : public AudioRecording {
 public:
  GstRecording(GstElement *pipeline, bool metering) : pipeline_(pipeline), metering_(metering) {
    GstBus *bus = gst_element_get_bus(pipeline_);
    gst_bus_set_sync_handler(bus, onRecordingMessage, &bus_, nullptr);
    gst_object_unref(bus);
  }

  ~GstRecording() override {
    stop();
    GstBus *bus = gst_element_get_bus(pipeline_);
    gst_bus_set_sync_handler(bus, nullptr, nullptr, nullptr);
    gst_object_unref(bus);
    gst_object_unref(pipeline_);
  }

  bool record() override {
    if (stopped_) {
      return false;
    }
    started_ = true;
    return gst_element_set_state(pipeline_, GST_STATE_PLAYING) != GST_STATE_CHANGE_FAILURE;
  }

  void pause() override {
    if (!stopped_) {
      time_ = position();
      gst_element_set_state(pipeline_, GST_STATE_PAUSED);
    }
  }

  void stop() override {
    if (stopped_) {
      return;
    }
    stopped_ = true;
    if (started_) {
      time_ = position();
      // The muxer writes its index at the end of the stream, so the stream ends before the pipeline
      // stops: a paused live source sends nothing, so it runs to carry the end through.
      gst_element_set_state(pipeline_, GST_STATE_PLAYING);
      gst_element_send_event(pipeline_, gst_event_new_eos());
      GstBus *bus = gst_element_get_bus(pipeline_);
      GstMessage *done = gst_bus_timed_pop_filtered(bus, 5 * GST_SECOND, static_cast<GstMessageType>(GST_MESSAGE_EOS | GST_MESSAGE_ERROR));
      if (done) {
        gst_message_unref(done);
      }
      gst_object_unref(bus);
    }
    gst_element_set_state(pipeline_, GST_STATE_NULL);
  }

  bool recording() override {
    if (stopped_) {
      return false;
    }
    GstState state = GST_STATE_NULL;
    gst_element_get_state(pipeline_, &state, nullptr, 0);
    return state == GST_STATE_PLAYING;
  }

  double currentTime() override {
    return stopped_ || !recording() ? time_ : position();
  }

  std::optional<double> metering() override {
    if (!metering_) {
      return std::nullopt;
    }
    return bus_.rms.load();
  }

 private:
  double position() {
    gint64 at = 0;
    return gst_element_query_position(pipeline_, GST_FORMAT_TIME, &at) && at > 0 ? static_cast<double>(at) / GST_SECOND : time_;
  }

  GstElement *pipeline_;
  bool metering_;
  RecordingBus bus_;
  bool started_{false};
  bool stopped_{false};
  double time_{0};
};

} // namespace

bool isMicrophone(const GstStructure *properties) {
  const gchar *kind = properties ? gst_structure_get_string(properties, "device.class") : nullptr;
  return g_strcmp0(kind, "monitor") != 0;
}

namespace {

bool deviceMonitorHasMicrophone() {
  GstDeviceMonitor *monitor = gst_device_monitor_new();
  gst_device_monitor_add_filter(monitor, "Audio/Source", nullptr);
  bool found = false;
  if (gst_device_monitor_start(monitor)) {
    GList *devices = gst_device_monitor_get_devices(monitor);
    for (GList *each = devices; each && !found; each = each->next) {
      GstStructure *properties = gst_device_get_properties(GST_DEVICE(each->data));
      found = isMicrophone(properties);
      if (properties) {
        gst_structure_free(properties);
      }
    }
    g_list_free_full(devices, gst_object_unref);
    gst_device_monitor_stop(monitor);
  }
  gst_object_unref(monitor);
  return found;
}

class GstInput final : public AudioInput {
 public:
  explicit GstInput(AudioInputSetup setup) : setup_(std::move(setup)) {
    if (setup_.source.empty()) {
      setup_.source = "pulsesrc";
    }
    if (!setup_.microphone) {
      setup_.microphone = deviceMonitorHasMicrophone;
    }
  }

  Access access() override { return Access::Granted; }
  void requestAccess(std::function<void(Access)> done) override { done(Access::Granted); }
  bool hasMicrophone() override { return setup_.microphone(); }

  std::unique_ptr<AudioRecording> prepare(const std::string &path, const RecordingSettings &settings, std::string &error) override {
    auto elements = recordingElementsOf(settings);
    if (!elements.error.empty()) {
      error = elements.error;
      return nullptr;
    }
    gchar *folder = g_path_get_dirname(path.c_str());
    g_mkdir_with_parents(folder, 0700);
    g_free(folder);
    std::string format = settings.format == "pcm" ? std::string(",format=") + pcmFormatOf(settings.bitDepth) : "";
    std::string line = setup_.source + " ! audioconvert ! audioresample ! audio/x-raw,rate=" +
                       std::to_string(static_cast<int>(settings.sampleRate)) + ",channels=" + std::to_string(settings.channels) +
                       format + (settings.metering ? " ! level interval=100000000" : "") +
                       (elements.encoder.empty() ? "" : " ! " + elements.encoder) + " ! " + elements.muxer +
                       " ! filesink name=file";
    GError *failure = nullptr;
    GstElement *pipeline = gst_parse_launch(line.c_str(), &failure);
    if (!pipeline || failure) {
      error = failure && failure->message ? failure->message : "the recording pipeline could not be made";
      if (failure) {
        g_error_free(failure);
      }
      if (pipeline) {
        gst_object_unref(pipeline);
      }
      return nullptr;
    }
    GstElement *file = gst_bin_get_by_name(GST_BIN(pipeline), "file");
    g_object_set(file, "location", path.c_str(), nullptr);
    gst_object_unref(file);
    auto recording = std::make_unique<GstRecording>(pipeline, settings.metering);
    // Opens the file and the source; a live source starts no data until it records.
    if (gst_element_set_state(pipeline, GST_STATE_PAUSED) == GST_STATE_CHANGE_FAILURE) {
      error = "the microphone or the file " + path + " could not be opened";
      return nullptr;
    }
    return recording;
  }

 private:
  static const char *pcmFormatOf(int bits) {
    switch (bits) {
      case 8: return "U8";
      case 24: return "S24LE";
      case 32: return "S32LE";
      default: return "S16LE";
    }
  }

  AudioInputSetup setup_;
};

} // namespace

RecordingElements recordingElementsOf(const RecordingSettings &settings) {
  const std::string &ext = settings.extension;
  auto first = [](std::initializer_list<const char *> names) -> std::string {
    for (const char *name : names) {
      if (gstreamerHas({name})) {
        return name;
      }
    }
    return {};
  };
  if (settings.format == "pcm") {
    if (ext == ".wav") {
      return {.encoder = "", .muxer = "wavenc"};
    }
    if ((ext == ".aif" || ext == ".aiff") && gstreamerHas({"aiffmux"})) {
      return {.encoder = "", .muxer = "aiffmux"};
    }
    return {.error = "Linux cannot record linear PCM into a " + ext + " file; use .wav"};
  }
  if (ext == ".ogg" || ext == ".opus" || ext == ".webm") {
    if (!gstreamerHas({"opusenc"})) {
      return {.error = "GStreamer's Opus encoder (opusenc) is not installed"};
    }
    return {.encoder = "opusenc bitrate=" + std::to_string(settings.bitRate), .muxer = ext == ".webm" ? "webmmux" : "oggmux"};
  }
  if (ext != ".m4a" && ext != ".mp4") {
    return {.error = "Linux cannot record into a " + ext + " file; use .m4a, .wav or .ogg"};
  }
  if (settings.format == "alac") {
    if (!gstreamerHas({"avenc_alac"})) {
      return {.error = "no ALAC encoder is installed (GStreamer's avenc_alac, from gst-libav)"};
    }
    return {.encoder = "avenc_alac", .muxer = "mp4mux"};
  }
  std::string aac = first({"fdkaacenc", "avenc_aac", "voaacenc"});
  if (aac.empty()) {
    return {.error = "no AAC encoder is installed (GStreamer's fdkaacenc, avenc_aac or voaacenc)"};
  }
  return {.encoder = aac + " bitrate=" + std::to_string(settings.bitRate), .muxer = "mp4mux"};
}

std::shared_ptr<AudioOutput> makeAudioOutput(std::string sink) {
  if (!gstreamerHas({"playbin3"})) {
    return nullptr;
  }
  return std::make_shared<GstOutput>(std::move(sink));
}

std::shared_ptr<AudioInput> makeAudioInput(AudioInputSetup setup) {
  if (!gstreamerHas({"audioconvert", "audioresample"}) || (setup.source.empty() && !gstreamerHas({"pulsesrc"}))) {
    return nullptr;
  }
  return std::make_shared<GstInput>(std::move(setup));
}

} // namespace ngn::gtk
