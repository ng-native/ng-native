#include "video.h"

#include "gst-frames.h"
#include "gst-playback.h"

#include <map>
#include <mutex>
#include <optional>
#include <vector>

namespace ngn::gtk {

namespace {

class GstVideoPlayer;

// A live player by its id, which its views find it by: its frames, and the player while it lives.
struct PlayerLink {
  std::mutex mutex;
  GstVideoPlayer *player{nullptr};
  std::shared_ptr<Frames> frames = std::make_shared<Frames>();
};

std::mutex gLinksMutex;
std::map<int, std::weak_ptr<PlayerLink>> gLinks;

std::shared_ptr<PlayerLink> linkFor(int id) {
  std::lock_guard lock(gLinksMutex);
  auto found = gLinks.find(id);
  return found != gLinks.end() ? found->second.lock() : nullptr;
}

using Change = VideoPlayback::Change;

class GstVideoPlayer final : public VideoPlayback {
 public:
  GstVideoPlayer(int id, std::string audioSink) : id_(id), audioSink_(std::move(audioSink)) {
    link_->player = this;
    std::lock_guard lock(gLinksMutex);
    gLinks[id] = link_;
  }

  ~GstVideoPlayer() override {
    {
      std::lock_guard lock(link_->mutex);
      link_->player = nullptr;
    }
    {
      std::lock_guard lock(gLinksMutex);
      if (auto found = gLinks.find(id_); found != gLinks.end() && found->second.lock() == link_) {
        gLinks.erase(found);
      }
    }
    std::lock_guard lock(mutex_);
    playback_.reset();
    Frames::post(link_->frames, nullptr);
  }

  void load(const std::optional<std::string> &uri, std::function<void(Change)> changed) override {
    std::lock_guard lock(mutex_);
    playback_.reset();
    Frames::post(link_->frames, nullptr);
    if (!uri) {
      return;
    }
    uri_ = *uri;
    changed_ = std::move(changed);
    open();
  }

  VideoState state() override {
    std::lock_guard lock(mutex_);
    VideoState out;
    if (!playback_) {
      return out;
    }
    auto now = playback_->state();
    out.load = now.load == PlaybackState::Load::Ready    ? VideoState::Load::Ready
               : now.load == PlaybackState::Load::Failed ? VideoState::Load::Failed
                                                         : VideoState::Load::Loading;
    out.error = now.error;
    out.playing = now.playing;
    out.buffering = now.buffering;
    out.currentTime = now.currentTime;
    out.duration = now.duration;
    out.bufferedPosition = now.bufferedPosition;
    return out;
  }

  void play(double rate) override {
    std::lock_guard lock(mutex_);
    rate_ = rate;
    if (playback_) {
      playback_->play(rate);
    }
  }

  // The view's controls: at the rate last asked for.
  void resume() {
    std::lock_guard lock(mutex_);
    if (playback_) {
      if (playback_->state().ended) {
        playback_->seek(0, nullptr);
      }
      playback_->play(rate_);
    }
  }

  void pause() override {
    std::lock_guard lock(mutex_);
    if (playback_) {
      playback_->pause();
    }
  }

  void seek(double seconds, std::function<void()> done) override {
    std::lock_guard lock(mutex_);
    if (playback_) {
      playback_->seek(seconds, std::move(done));
    } else if (done) {
      done();
    }
  }

  void setRate(double rate) override {
    std::lock_guard lock(mutex_);
    rate_ = rate;
    if (playback_) {
      playback_->setRate(rate);
    }
  }

  void setVolume(double volume) override {
    std::lock_guard lock(mutex_);
    volume_ = volume;
    if (playback_) {
      playback_->setVolume(volume);
    }
  }

  void setMuted(bool muted) override {
    std::lock_guard lock(mutex_);
    muted_ = muted;
    if (playback_) {
      playback_->setMuted(muted);
    }
  }

  // playbin3 takes its audio filter only as it is made: a source playing is opened again with the
  // new one, at its place and playing as it was.
  void setPreservesPitch(bool preserves) override {
    std::lock_guard lock(mutex_);
    if (pitch_ == preserves) {
      return;
    }
    pitch_ = preserves;
    if (!playback_) {
      return;
    }
    auto was = playback_->state();
    open();
    playback_->seek(was.currentTime, nullptr);
    if (was.playing) {
      playback_->play(rate_);
    }
  }

  void setTimeUpdates(double interval) override {
    std::lock_guard lock(mutex_);
    interval_ = interval;
    if (playback_) {
      playback_->setInterval(interval);
    }
  }

  std::shared_ptr<PlayerLink> link() const { return link_; }

 private:
  // A new pipeline for the source, with the settings as they are. Under `mutex_`.
  void open() {
    playback_.reset();
    auto changed = changed_;
    playback_ = std::make_unique<Playback>(
        uri_,
        Playback::Options{.audioSink = audioSink_, .videoSink = makeFrameSink(link_->frames, true), .video = true, .preservePitch = pitch_,
                          .interval = interval_},
        [changed](Playback::Change change) {
          changed(change == Playback::Change::Ended ? Change::Ended : change == Playback::Change::Time ? Change::Time : Change::State);
        });
    playback_->setVolume(volume_);
    playback_->setMuted(muted_);
  }

  std::string uri_;
  std::function<void(Change)> changed_;
  int id_;
  std::string audioSink_;
  std::shared_ptr<PlayerLink> link_ = std::make_shared<PlayerLink>();
  std::mutex mutex_;
  std::unique_ptr<Playback> playback_;
  double rate_{1};
  double volume_{1};
  bool muted_{false};
  bool pitch_{true};
  double interval_{0};
};

class GstVideoOutput final : public VideoOutput {
 public:
  explicit GstVideoOutput(std::string audioSink) : audioSink_(std::move(audioSink)) {}
  std::unique_ptr<VideoPlayback> make(int id) override { return std::make_unique<GstVideoPlayer>(id, audioSink_); }

 private:
  std::string audioSink_;
};

// Runs `fn` with the live player `link` holds, if it still lives.
template <typename Fn>
void withPlayer(const std::shared_ptr<PlayerLink> &link, Fn fn) {
  if (!link) {
    return;
  }
  std::lock_guard lock(link->mutex);
  if (link->player) {
    fn(*link->player);
  }
}

GtkContentFit fitOf(VideoViewModel::Fit fit) {
  switch (fit) {
    case VideoViewModel::Fit::Cover: return GTK_CONTENT_FIT_COVER;
    case VideoViewModel::Fit::Fill: return GTK_CONTENT_FIT_FILL;
    default: return GTK_CONTENT_FIT_CONTAIN;
  }
}

} // namespace

struct VideoSurface {
  // Fills the view, and moves with its children to a widget that replaces it.
  GtkWidget *overlay{nullptr};
  GtkPicture *picture{nullptr};
  GtkWidget *controls{nullptr};
  GtkWidget *playButton{nullptr};
  GtkWidget *scale{nullptr};
  GtkWidget *fullButton{nullptr};
  std::function<void(const std::string &)> events;
  // The view is going: it sends nothing more.
  bool detached{false};
  VideoViewModel model;
  std::shared_ptr<PlayerLink> link;
  int watcher{-1};
  bool firstShown{false};
  GtkWindow *fullscreen{nullptr};
  GtkPicture *fullPicture{nullptr};
  int fullWatcher{-1};
  guint timer{0};
  // The position the controls last set on the scale, so its own change is not taken for a drag.
  bool updating{false};

  ~VideoSurface();
  void send(const char *name) {
    if (!detached && events) {
      events(name);
    }
  }
};

namespace {

void unwatch(const std::shared_ptr<PlayerLink> &link, int &watcher) {
  if (link && watcher >= 0) {
    link->frames->unwatch(watcher);
  }
  watcher = -1;
}

int watch(const std::shared_ptr<PlayerLink> &link, std::function<void(GdkTexture *)> shown) {
  return link->frames->watch(std::move(shown));
}

void updateControls(VideoSurface &s) {
  if (!s.controls) {
    return;
  }
  std::optional<VideoState> state;
  withPlayer(s.link, [&](GstVideoPlayer &player) { state = player.state(); });
  bool playing = state && state->playing;
  gtk_button_set_icon_name(GTK_BUTTON(s.playButton), playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic");
  gtk_widget_set_tooltip_text(s.playButton, playing ? "Pause" : "Play");
  s.updating = true;
  GtkAdjustment *adjustment = gtk_range_get_adjustment(GTK_RANGE(s.scale));
  gtk_adjustment_set_upper(adjustment, state && state->duration > 0 ? state->duration : 1);
  gtk_adjustment_set_value(adjustment, state ? state->currentTime : 0);
  s.updating = false;
  gtk_widget_set_sensitive(s.scale, state && state->duration > 0);
}

void closeFullscreen(VideoSurface &s) {
  if (!s.fullscreen) {
    return;
  }
  unwatch(s.link, s.fullWatcher);
  GtkWindow *window = std::exchange(s.fullscreen, nullptr);
  s.fullPicture = nullptr;
  g_signal_handlers_disconnect_by_data(window, &s);
  gtk_window_destroy(window);
  // Sent even once detached: expo-video's view is gone, but the event is the last word on it.
  if (s.events) {
    s.events("fullscreenExit");
  }
}

void attachPlayer(VideoSurface &s) {
  std::shared_ptr<PlayerLink> link = s.model.player ? linkFor(*s.model.player) : nullptr;
  if (link == s.link) {
    return;
  }
  unwatch(s.link, s.watcher);
  unwatch(s.link, s.fullWatcher);
  s.link = link;
  s.firstShown = false;
  gtk_picture_set_paintable(s.picture, nullptr);
  if (s.fullPicture) {
    gtk_picture_set_paintable(s.fullPicture, nullptr);
  }
  if (!link) {
    return;
  }
  auto show = [&s](GdkTexture *texture) {
    gtk_picture_set_paintable(s.picture, texture ? GDK_PAINTABLE(texture) : nullptr);
    if (texture && !s.firstShown) {
      s.firstShown = true;
      s.send("firstFrameRender");
    } else if (!texture) {
      // A new source: its first frame is a first frame again.
      s.firstShown = false;
    }
  };
  s.watcher = watch(link, show);
  if (link->frames->shown()) {
    show(link->frames->shown());
  }
  if (s.fullPicture) {
    s.fullWatcher = watch(link, [&s](GdkTexture *texture) { gtk_picture_set_paintable(s.fullPicture, texture ? GDK_PAINTABLE(texture) : nullptr); });
    gtk_picture_set_paintable(s.fullPicture, link->frames->shown() ? GDK_PAINTABLE(link->frames->shown()) : nullptr);
  }
}

void openFullscreen(VideoSurface &s) {
  if (s.fullscreen || s.detached) {
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_title(GTK_WINDOW(window), "Video");
  if (GtkRoot *root = gtk_widget_get_root(s.overlay); root && GTK_IS_WINDOW(root)) {
    gtk_window_set_transient_for(GTK_WINDOW(window), GTK_WINDOW(root));
    if (GtkApplication *app = gtk_window_get_application(GTK_WINDOW(root))) {
      gtk_window_set_application(GTK_WINDOW(window), app);
    }
  }
  GtkWidget *picture = gtk_picture_new();
  gtk_picture_set_content_fit(GTK_PICTURE(picture), GTK_CONTENT_FIT_CONTAIN);
  gtk_widget_add_css_class(window, "ngn-video-fullscreen");
  gtk_window_set_child(GTK_WINDOW(window), picture);
  s.fullscreen = GTK_WINDOW(window);
  s.fullPicture = GTK_PICTURE(picture);
  if (s.link) {
    s.fullWatcher = watch(s.link, [&s](GdkTexture *texture) { gtk_picture_set_paintable(s.fullPicture, texture ? GDK_PAINTABLE(texture) : nullptr); });
    gtk_picture_set_paintable(s.fullPicture, s.link->frames->shown() ? GDK_PAINTABLE(s.link->frames->shown()) : nullptr);
  }
  GtkEventController *keys = gtk_event_controller_key_new();
  g_signal_connect(keys, "key-pressed", G_CALLBACK(+[](GtkEventControllerKey *, guint key, guint, GdkModifierType, gpointer data) -> gboolean {
    if (key == GDK_KEY_Escape) {
      closeFullscreen(*static_cast<VideoSurface *>(data));
      return TRUE;
    }
    return FALSE;
  }), &s);
  gtk_widget_add_controller(window, keys);
  g_signal_connect(window, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer data) -> gboolean {
    closeFullscreen(*static_cast<VideoSurface *>(data));
    return TRUE;
  }), &s);
  // Asked, not awaited: a window manager may not make it full screen, and Xvfb has none.
  gtk_window_fullscreen(GTK_WINDOW(window));
  gtk_window_present(GTK_WINDOW(window));
  s.send("fullscreenEnter");
}

void buildControls(VideoSurface &s) {
  s.controls = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
  gtk_widget_add_css_class(s.controls, "osd");
  gtk_widget_add_css_class(s.controls, "toolbar");
  gtk_widget_set_valign(s.controls, GTK_ALIGN_END);
  gtk_widget_set_margin_start(s.controls, 8);
  gtk_widget_set_margin_end(s.controls, 8);
  gtk_widget_set_margin_bottom(s.controls, 8);
  s.playButton = gtk_button_new_from_icon_name("media-playback-start-symbolic");
  gtk_widget_add_css_class(s.playButton, "flat");
  g_signal_connect(s.playButton, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
    auto &s = *static_cast<VideoSurface *>(data);
    withPlayer(s.link, [](GstVideoPlayer &player) {
      if (player.state().playing) {
        player.pause();
      } else {
        player.resume();
      }
    });
    updateControls(s);
  }), &s);
  s.scale = gtk_scale_new_with_range(GTK_ORIENTATION_HORIZONTAL, 0, 1, 0.1);
  gtk_scale_set_draw_value(GTK_SCALE(s.scale), FALSE);
  gtk_widget_set_hexpand(s.scale, TRUE);
  gtk_accessible_update_property(GTK_ACCESSIBLE(s.scale), GTK_ACCESSIBLE_PROPERTY_LABEL, "Position", -1);
  g_signal_connect(s.scale, "value-changed", G_CALLBACK(+[](GtkRange *range, gpointer data) {
    auto &s = *static_cast<VideoSurface *>(data);
    if (s.updating) {
      return;
    }
    double to = gtk_range_get_value(range);
    withPlayer(s.link, [to](GstVideoPlayer &player) { player.seek(to, nullptr); });
  }), &s);
  s.fullButton = gtk_button_new_from_icon_name("view-fullscreen-symbolic");
  gtk_widget_add_css_class(s.fullButton, "flat");
  gtk_widget_set_tooltip_text(s.fullButton, "Full Screen");
  g_signal_connect(s.fullButton, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) { openFullscreen(*static_cast<VideoSurface *>(data)); }), &s);
  gtk_box_append(GTK_BOX(s.controls), s.playButton);
  gtk_box_append(GTK_BOX(s.controls), s.scale);
  gtk_box_append(GTK_BOX(s.controls), s.fullButton);
  gtk_overlay_add_overlay(GTK_OVERLAY(s.overlay), s.controls);
  s.timer = g_timeout_add(250, [](gpointer data) -> gboolean {
    updateControls(*static_cast<VideoSurface *>(data));
    return G_SOURCE_CONTINUE;
  }, &s);
}

void dropControls(VideoSurface &s) {
  if (!s.controls) {
    return;
  }
  if (s.timer) {
    g_source_remove(s.timer);
    s.timer = 0;
  }
  gtk_overlay_remove_overlay(GTK_OVERLAY(s.overlay), s.controls);
  s.controls = s.playButton = s.scale = s.fullButton = nullptr;
}

} // namespace

VideoSurface::~VideoSurface() {
  dropControls(*this);
  // The view is going: its emitter with it.
  detached = true;
  events = nullptr;
  closeFullscreen(*this);
  unwatch(link, watcher);
  if (overlay) {
    if (gtk_widget_get_parent(overlay)) {
      gtk_widget_unparent(overlay);
    }
    g_object_unref(overlay);
  }
}

std::shared_ptr<VideoOutput> makeVideoOutput(std::string audioSink) {
  if (!gstreamerHas({"playbin3", "appsink", "videoconvert"})) {
    return nullptr;
  }
  return std::make_shared<GstVideoOutput>(std::move(audioSink));
}

std::shared_ptr<VideoSurface> makeVideoSurface(GtkWidget *view, std::function<void(const std::string &)> events) {
  auto s = std::make_shared<VideoSurface>();
  s->events = std::move(events);
  s->overlay = GTK_WIDGET(g_object_ref_sink(gtk_overlay_new()));
  GtkWidget *picture = gtk_picture_new();
  gtk_picture_set_can_shrink(GTK_PICTURE(picture), TRUE);
  s->picture = GTK_PICTURE(picture);
  gtk_overlay_set_child(GTK_OVERLAY(s->overlay), picture);
  gtk_widget_set_parent(s->overlay, view);
  applyVideoSurface(*s, VideoViewModel{});
  return s;
}

void applyVideoSurface(VideoSurface &s, const VideoViewModel &model) {
  bool controls = model.nativeControls;
  s.model = model;
  attachPlayer(s);
  gtk_picture_set_content_fit(s.picture, fitOf(model.contentFit));
  if (controls && !s.controls) {
    buildControls(s);
  } else if (!controls) {
    dropControls(s);
  }
  if (s.fullButton) {
    gtk_widget_set_visible(s.fullButton, model.fullscreen);
  }
  updateControls(s);
}

void setVideoFullscreen(VideoSurface &s, bool on) {
  if (on) {
    openFullscreen(s);
  } else {
    closeFullscreen(s);
  }
}

GtkWindow *videoFullscreenWindow(VideoSurface &s) {
  return s.fullscreen;
}

GtkPicture *videoPicture(VideoSurface &s) {
  return s.picture;
}

GtkWidget *videoPlayButton(VideoSurface &s) {
  return s.playButton;
}

GtkWidget *videoWidget(VideoSurface &s) {
  return s.overlay;
}

} // namespace ngn::gtk
