#include "gst-playback.h"

#include <gst/pbutils/missing-plugins.h>

#include <algorithm>
#include <mutex>
#include <utility>
#include <vector>

namespace ngn::gtk {

bool gstreamerHas(std::initializer_list<const char *> elements) {
  static bool ready = [] { return gst_init_check(nullptr, nullptr, nullptr) == TRUE; }();
  if (!ready) {
    return false;
  }
  for (const char *name : elements) {
    GstElementFactory *factory = gst_element_factory_find(name);
    if (!factory) {
      return false;
    }
    gst_object_unref(factory);
  }
  return true;
}

namespace {

// GstPlayFlags, which playbin3 takes as a flags property of its own type.
constexpr guint kPlayVideo = 1 << 0;
constexpr guint kPlayText = 1 << 2;

double secondsOf(gint64 time) {
  return time > 0 ? static_cast<double>(time) / GST_SECOND : 0;
}

} // namespace

struct Playback::Shared {
  std::mutex mutex;
  GstElement *pipeline{nullptr};
  std::function<void(Change)> changed;
  bool alive{true};
  bool file{false};
  PlaybackState::Load load{PlaybackState::Load::Loading};
  std::string error;
  bool prerolled{false};
  bool wantPlaying{false};
  bool ended{false};
  bool buffering{false};
  // The rate the pipeline plays at, and the one asked for: a seek applies it.
  double rate{1};
  double appliedRate{1};
  // A seek asked before the source prerolled, run once it has.
  std::optional<double> pendingSeek;
  bool seeking{false};
  std::vector<std::function<void()>> seekDone;
  GSource *bus{nullptr};
  guint timer{0};
  double interval{0};
  // The state last set on the pipeline, so a request for the same one does nothing.
  GstState target{GST_STATE_PAUSED};

  // What the pipeline should be in, from what was asked and what it is doing. Under `mutex`.
  GstState wanted() const {
    return wantPlaying && !ended && !buffering && load != PlaybackState::Load::Failed ? GST_STATE_PLAYING : GST_STATE_PAUSED;
  }
};

namespace {

using Shared = Playback::Shared;
using Change = Playback::Change;

void send(const std::shared_ptr<Shared> &shared, Change change) {
  {
    std::lock_guard lock(shared->mutex);
    if (!shared->alive) {
      return;
    }
  }
  shared->changed(change);
}

void startTimer(const std::shared_ptr<Shared> &shared);

// Sets the pipeline to the state `wanted` gives, and runs the interval while it plays. Not under
// `mutex`.
void apply(const std::shared_ptr<Shared> &shared) {
  GstState next;
  bool timer = false;
  {
    std::lock_guard lock(shared->mutex);
    if (!shared->alive || !shared->pipeline) {
      return;
    }
    next = shared->wanted();
    if (next == shared->target) {
      return;
    }
    shared->target = next;
    timer = next == GST_STATE_PLAYING && shared->interval > 0 && shared->timer == 0;
    if (next != GST_STATE_PLAYING && shared->timer != 0) {
      g_source_remove(shared->timer);
      shared->timer = 0;
    }
  }
  gst_element_set_state(shared->pipeline, next);
  if (timer) {
    startTimer(shared);
  }
}

void startTimer(const std::shared_ptr<Shared> &shared) {
  std::lock_guard lock(shared->mutex);
  if (!shared->alive || shared->timer != 0 || shared->interval <= 0) {
    return;
  }
  auto *weak = new std::weak_ptr<Shared>(shared);
  shared->timer = g_timeout_add_full(G_PRIORITY_DEFAULT, static_cast<guint>(shared->interval * 1000), [](gpointer data) -> gboolean {
    auto shared = static_cast<std::weak_ptr<Shared> *>(data)->lock();
    if (shared) {
      send(shared, Change::Time);
    }
    return shared ? G_SOURCE_CONTINUE : G_SOURCE_REMOVE;
  }, weak, [](gpointer data) { delete static_cast<std::weak_ptr<Shared> *>(data); });
}

// A flushing, accurate seek at the rate asked for. Not under `mutex`.
bool seekTo(const std::shared_ptr<Shared> &shared, double seconds) {
  double rate;
  {
    std::lock_guard lock(shared->mutex);
    rate = shared->rate;
    shared->appliedRate = rate;
    shared->seeking = true;
    shared->ended = false;
  }
  gint64 at = static_cast<gint64>(std::max(0.0, seconds) * GST_SECOND);
  bool ok = gst_element_seek(shared->pipeline, rate, GST_FORMAT_TIME, static_cast<GstSeekFlags>(GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_ACCURATE),
                             GST_SEEK_TYPE_SET, at, GST_SEEK_TYPE_NONE, GST_CLOCK_TIME_NONE);
  if (!ok) {
    std::lock_guard lock(shared->mutex);
    shared->seeking = false;
  }
  return ok;
}

void finishSeeks(const std::shared_ptr<Shared> &shared) {
  std::vector<std::function<void()>> done;
  {
    std::lock_guard lock(shared->mutex);
    done.swap(shared->seekDone);
  }
  for (auto &each : done) {
    each();
  }
}

void fail(const std::shared_ptr<Shared> &shared, std::string message) {
  {
    std::lock_guard lock(shared->mutex);
    if (shared->load == PlaybackState::Load::Failed) {
      return;
    }
    shared->load = PlaybackState::Load::Failed;
    shared->error = std::move(message);
  }
  finishSeeks(shared);
  apply(shared);
  send(shared, Change::State);
}

gboolean onMessage(GstBus *, GstMessage *message, gpointer data) {
  auto shared = *static_cast<std::shared_ptr<Shared> *>(data);
  switch (GST_MESSAGE_TYPE(message)) {
    case GST_MESSAGE_ERROR: {
      GError *error = nullptr;
      gst_message_parse_error(message, &error, nullptr);
      fail(shared, error && error->message ? error->message : "The source did not play");
      if (error) {
        g_error_free(error);
      }
      break;
    }
    case GST_MESSAGE_ELEMENT:
      if (gst_is_missing_plugin_message(message)) {
        gchar *what = gst_missing_plugin_message_get_description(message);
        fail(shared, std::string("No decoder is installed for ") + (what ? what : "this source") +
                         ": install the GStreamer plugin that plays it");
        g_free(what);
      }
      break;
    case GST_MESSAGE_ASYNC_DONE: {
      std::optional<double> pending;
      bool first = false;
      bool seeked = false;
      {
        std::lock_guard lock(shared->mutex);
        first = !shared->prerolled;
        shared->prerolled = true;
        if (shared->load == PlaybackState::Load::Loading) {
          shared->load = PlaybackState::Load::Ready;
        }
        pending.swap(shared->pendingSeek);
        if (!pending && shared->rate != shared->appliedRate) {
          // A rate asked for before the source prerolled.
          pending = -1;
        }
        seeked = shared->seeking;
        shared->seeking = false;
      }
      if (pending) {
        gint64 now = 0;
        double at = *pending >= 0 ? *pending : (gst_element_query_position(shared->pipeline, GST_FORMAT_TIME, &now) ? secondsOf(now) : 0);
        if (seekTo(shared, at)) {
          break;
        }
      }
      if (seeked || first) {
        finishSeeks(shared);
      }
      apply(shared);
      send(shared, Change::State);
      break;
    }
    case GST_MESSAGE_EOS: {
      {
        std::lock_guard lock(shared->mutex);
        shared->ended = true;
      }
      apply(shared);
      send(shared, Change::Ended);
      break;
    }
    case GST_MESSAGE_BUFFERING: {
      gint percent = 100;
      gst_message_parse_buffering(message, &percent);
      bool changed;
      {
        std::lock_guard lock(shared->mutex);
        bool buffering = percent < 100;
        changed = buffering != shared->buffering;
        shared->buffering = buffering;
      }
      if (changed) {
        apply(shared);
        send(shared, Change::State);
      }
      break;
    }
    case GST_MESSAGE_STATE_CHANGED:
      if (GST_MESSAGE_SRC(message) == GST_OBJECT(shared->pipeline)) {
        GstState old, now;
        gst_message_parse_state_changed(message, &old, &now, nullptr);
        if (old == GST_STATE_PLAYING || now == GST_STATE_PLAYING) {
          send(shared, Change::State);
        }
      }
      break;
    case GST_MESSAGE_DURATION_CHANGED: send(shared, Change::State); break;
    default: break;
  }
  return G_SOURCE_CONTINUE;
}

} // namespace

Playback::Playback(const std::string &uri, Options options, std::function<void(Change)> changed)
    : shared_(std::make_shared<Shared>()) {
  shared_->changed = std::move(changed);
  shared_->interval = options.interval;
  shared_->file = uri.rfind("file:", 0) == 0;
  GstElement *pipeline = gst_element_factory_make("playbin3", nullptr);
  if (!pipeline) {
    shared_->load = PlaybackState::Load::Failed;
    shared_->error = "GStreamer's playbin3 is not installed";
    if (options.videoSink) {
      gst_object_unref(gst_object_ref_sink(options.videoSink));
    }
    return;
  }
  shared_->pipeline = GST_ELEMENT(gst_object_ref_sink(pipeline));
  guint flags = 0;
  g_object_get(pipeline, "flags", &flags, nullptr);
  flags &= ~kPlayText;
  if (!options.videoSink) {
    flags &= ~kPlayVideo;
  }
  g_object_set(pipeline, "uri", uri.c_str(), "flags", flags, nullptr);
  if (options.videoSink) {
    g_object_set(pipeline, "video-sink", options.videoSink, nullptr);
  }
  if (!options.audioSink.empty()) {
    if (GstElement *sink = gst_element_factory_make(options.audioSink.c_str(), nullptr)) {
      if (g_object_class_find_property(G_OBJECT_GET_CLASS(sink), "sync")) {
        g_object_set(sink, "sync", TRUE, nullptr);
      }
      g_object_set(pipeline, "audio-sink", sink, nullptr);
    }
  }
  if (options.preservePitch) {
    if (GstElement *tempo = gst_element_factory_make("scaletempo", nullptr)) {
      g_object_set(pipeline, "audio-filter", tempo, nullptr);
    }
  }
  GstBus *bus = gst_element_get_bus(pipeline);
  shared_->bus = gst_bus_create_watch(bus);
  g_source_set_callback(shared_->bus, reinterpret_cast<GSourceFunc>(+onMessage), new std::shared_ptr<Shared>(shared_),
                        [](gpointer data) { delete static_cast<std::shared_ptr<Shared> *>(data); });
  // The default context, the GTK main loop's, whichever thread makes the player.
  g_source_attach(shared_->bus, nullptr);
  gst_object_unref(bus);
  if (gst_element_set_state(pipeline, GST_STATE_PAUSED) == GST_STATE_CHANGE_FAILURE) {
    shared_->load = PlaybackState::Load::Failed;
    shared_->error = "The source could not be opened";
  }
}

Playback::~Playback() {
  GSource *bus;
  guint timer;
  {
    std::lock_guard lock(shared_->mutex);
    shared_->alive = false;
    bus = std::exchange(shared_->bus, nullptr);
    timer = std::exchange(shared_->timer, 0);
  }
  if (bus) {
    // Drops the watch's hold on `shared_` once a dispatch running now returns.
    g_source_destroy(bus);
    g_source_unref(bus);
  }
  if (timer) {
    g_source_remove(timer);
  }
  if (shared_->pipeline) {
    gst_element_set_state(shared_->pipeline, GST_STATE_NULL);
    gst_object_unref(shared_->pipeline);
  }
  finishSeeks(shared_);
}

PlaybackState Playback::state() {
  PlaybackState out;
  bool file;
  {
    std::lock_guard lock(shared_->mutex);
    out.load = shared_->load;
    out.error = shared_->error;
    out.ended = shared_->ended;
    out.buffering = shared_->buffering && shared_->wantPlaying;
    out.playing = shared_->wantPlaying && !shared_->ended && shared_->load != PlaybackState::Load::Failed;
    file = shared_->file;
  }
  if (!shared_->pipeline) {
    return out;
  }
  gint64 duration = 0, position = 0;
  if (gst_element_query_duration(shared_->pipeline, GST_FORMAT_TIME, &duration)) {
    out.duration = secondsOf(duration);
  }
  if (out.ended && out.duration > 0) {
    out.currentTime = out.duration;
  } else if (gst_element_query_position(shared_->pipeline, GST_FORMAT_TIME, &position)) {
    out.currentTime = secondsOf(position);
  }
  out.bufferedPosition = file ? out.duration : out.currentTime;
  GstQuery *query = gst_query_new_buffering(GST_FORMAT_TIME);
  if (!file && gst_element_query(shared_->pipeline, query)) {
    gint64 start = 0, stop = 0;
    gst_query_parse_buffering_range(query, nullptr, &start, &stop, nullptr);
    if (stop > 0) {
      out.bufferedPosition = secondsOf(stop);
    }
  }
  gst_query_unref(query);
  return out;
}

void Playback::play(double rate) {
  if (rate <= 0) {
    pause();
    return;
  }
  bool reseek;
  {
    std::lock_guard lock(shared_->mutex);
    shared_->wantPlaying = true;
    shared_->rate = rate;
    reseek = shared_->prerolled && rate != shared_->appliedRate && shared_->load != PlaybackState::Load::Failed;
  }
  if (reseek) {
    gint64 now = 0;
    seekTo(shared_, gst_element_query_position(shared_->pipeline, GST_FORMAT_TIME, &now) ? secondsOf(now) : 0);
  }
  apply(shared_);
}

void Playback::pause() {
  {
    std::lock_guard lock(shared_->mutex);
    shared_->wantPlaying = false;
  }
  apply(shared_);
}

void Playback::seek(double seconds, std::function<void()> done) {
  bool playable;
  {
    std::lock_guard lock(shared_->mutex);
    playable = shared_->pipeline && shared_->load != PlaybackState::Load::Failed;
    if (playable) {
      if (done) {
        shared_->seekDone.push_back(std::move(done));
      }
      if (!shared_->prerolled) {
        shared_->pendingSeek = seconds;
        return;
      }
    }
  }
  if (!playable) {
    if (done) {
      done();
    }
    return;
  }
  if (!seekTo(shared_, seconds)) {
    finishSeeks(shared_);
  }
}

void Playback::setRate(double rate) {
  bool playing;
  {
    std::lock_guard lock(shared_->mutex);
    shared_->rate = rate;
    playing = shared_->wantPlaying;
  }
  if (playing && rate > 0) {
    play(rate);
  }
}

void Playback::setVolume(double volume) {
  if (shared_->pipeline) {
    g_object_set(shared_->pipeline, "volume", std::clamp(volume, 0.0, 1.0), nullptr);
  }
}

void Playback::setMuted(bool muted) {
  if (shared_->pipeline) {
    g_object_set(shared_->pipeline, "mute", muted ? TRUE : FALSE, nullptr);
  }
}

void Playback::setInterval(double seconds) {
  {
    std::lock_guard lock(shared_->mutex);
    shared_->interval = seconds;
    if (shared_->timer != 0) {
      g_source_remove(shared_->timer);
      shared_->timer = 0;
    }
    if (seconds <= 0 || shared_->target != GST_STATE_PLAYING) {
      return;
    }
  }
  startTimer(shared_);
}

} // namespace ngn::gtk
