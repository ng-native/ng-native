#include "camera.h"

#include "audio.h"
#include "gst-frames.h"
#include "gst-playback.h"
#include "portal.h"

#include <gdk-pixbuf/gdk-pixbuf.h>
#include <gst/pbutils/pbutils.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <optional>

namespace ngn::gtk {

namespace {

constexpr const char *kCamera = "org.freedesktop.portal.Camera";
using Access = CameraHardware::Access;

// The first of `names` installed, or empty.
std::string firstInstalled(std::initializer_list<const char *> names) {
  for (const char *name : names) {
    if (gstreamerHas({name})) {
      return name;
    }
  }
  return {};
}

class GstCameraCapture;

class PortalCamera final : public CameraHardware {
 public:
  explicit PortalCamera(CameraSetup setup) : setup_(std::move(setup)) {}

  Access access() override { return setup_.source.empty() ? access_.load() : Access::Granted; }

  void requestAccess(std::function<void(Access)> done) override {
    if (!setup_.source.empty()) {
      done(Access::Granted);
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    auto *self = this;
    // On the main loop: the portal helper's requests are made and answered there.
    auto *call = new std::function<void()>([self, answer] {
      portal::request(kCamera, "AccessCamera", g_variant_new("()"), g_variant_builder_new(G_VARIANT_TYPE_VARDICT), nullptr,
                      [self, answer](portal::Outcome outcome, GVariant *) {
                        Access decided = outcome == portal::Outcome::Done     ? Access::Granted
                                         : outcome == portal::Outcome::Absent ? Access::Restricted
                                                                              : Access::Denied;
                        self->access_ = decided;
                        (*answer)(decided);
                      });
    });
    g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer data) -> gboolean {
      (*static_cast<std::function<void()> *>(data))();
      return G_SOURCE_REMOVE;
    }, call, [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
  }

  bool hasCamera() override {
    if (!setup_.source.empty()) {
      return true;
    }
    GVariant *present = portal::property(kCamera, "IsCameraPresent");
    bool out = present && g_variant_is_of_type(present, G_VARIANT_TYPE_BOOLEAN) && g_variant_get_boolean(present);
    if (present) {
      g_variant_unref(present);
    }
    return out;
  }

  bool microphoneAllowed() override {
    return setup_.microphone && setup_.microphone->access() == AudioInput::Access::Granted && setup_.microphone->hasMicrophone();
  }

  // A new stream from the camera, as a bin with one source pad, and the PipeWire connection's fd it
  // holds (-1 for none), or null with `error` set.
  GstElement *source(int &fd, std::string &error) {
    fd = -1;
    GError *failure = nullptr;
    if (!setup_.source.empty()) {
      GstElement *bin = gst_parse_bin_from_description(setup_.source.c_str(), TRUE, &failure);
      if (!bin) {
        error = failure ? failure->message : "the camera could not be opened";
        g_clear_error(&failure);
      }
      return bin;
    }
    fd = portal::openPipeWireRemote(kCamera);
    if (fd < 0) {
      error = "Camera could not be started - the Camera portal opened no connection to the camera.";
      return nullptr;
    }
    GstElement *src = gst_element_factory_make("pipewiresrc", nullptr);
    if (!src) {
      close(fd);
      fd = -1;
      error = "GStreamer's PipeWire plugin (pipewiresrc) is not installed";
      return nullptr;
    }
    // pipewiresrc connects over a duplicate of the fd: the capture closes this one as it goes.
    g_object_set(src, "fd", fd, nullptr);
    return src;
  }

  const CameraSetup &setup() const { return setup_; }

 private:
  CameraSetup setup_;
  std::atomic<Access> access_{Access::NotDetermined};
};

// A recording in a pipeline of its own: a second stream from the camera into a movie.
struct Recording {
  GstElement *pipeline{nullptr};
  int fd{-1};
  std::string path;
  double maxFileSize{0};
  gint64 started{0};
  std::function<void(const std::string &)> done;
  guint poll{0};
  guint limit{0};
  bool ending{false};
};

class GstCameraCapture final : public CameraCapture, public std::enable_shared_from_this<GstCameraCapture> {
 public:
  GstCameraCapture(std::shared_ptr<PortalCamera> camera, GstElement *pipeline, GstElement *sink, int fd, std::shared_ptr<Frames> frames)
      : camera_(std::move(camera)), pipeline_(pipeline), sink_(sink), fd_(fd), frames_(std::move(frames)) {}

  ~GstCameraCapture() override {
    endRecording(true, "");
    gst_element_set_state(pipeline_, GST_STATE_NULL);
    gst_object_unref(sink_);
    gst_object_unref(pipeline_);
    if (fd_ >= 0) {
      close(fd_);
    }
  }

  const std::shared_ptr<Frames> &frames() const { return frames_; }

  void takePicture(const CameraPictureRequest &request, std::function<void(int, int, const std::string &)> done) override {
    GstSample *sample = nullptr;
    g_object_get(sink_, "last-sample", &sample, nullptr);
    GdkTexture *texture = sample ? textureOfSample(sample) : nullptr;
    if (sample) {
      gst_sample_unref(sample);
    }
    if (!texture) {
      done(0, 0, "Camera has not shown a frame yet");
      return;
    }
    int width = gdk_texture_get_width(texture), height = gdk_texture_get_height(texture);
    std::string error;
    gchar *folder = g_path_get_dirname(request.path.c_str());
    g_mkdir_with_parents(folder, 0700);
    g_free(folder);
    if (request.format == "png") {
      if (!gdk_texture_save_to_png(texture, request.path.c_str())) {
        error = "the picture could not be written to " + request.path;
      }
    } else {
      G_GNUC_BEGIN_IGNORE_DEPRECATIONS
      GdkPixbuf *pixbuf = gdk_pixbuf_get_from_texture(texture);
      G_GNUC_END_IGNORE_DEPRECATIONS
      std::string quality = std::to_string(static_cast<int>(std::clamp(request.quality, 0.0, 1.0) * 100));
      GError *failure = nullptr;
      if (!pixbuf || !gdk_pixbuf_save(pixbuf, request.path.c_str(), "jpeg", &failure, "quality", quality.c_str(), nullptr)) {
        error = failure ? failure->message : "the picture could not be written to " + request.path;
      }
      g_clear_error(&failure);
      if (pixbuf) {
        g_object_unref(pixbuf);
      }
    }
    g_object_unref(texture);
    done(error.empty() ? width : 0, error.empty() ? height : 0, error);
  }

  void startRecording(const CameraRecordingRequest &request, std::function<void(const std::string &)> done) override {
    std::lock_guard lock(mutex_);
    if (recording_) {
      done("Camera is already recording");
      return;
    }
    std::string error;
    int fd = -1;
    GstElement *source = camera_->source(fd, error);
    if (!source) {
      done(error);
      return;
    }
    std::string video = request.codec == "jpeg" ? std::string("jpegenc") : firstInstalled({"x264enc", "openh264enc"});
    if (video.empty()) {
      video = "jpegenc";
    }
    std::string aac = request.sound ? firstInstalled({"fdkaacenc", "avenc_aac", "voaacenc"}) : "";
    const auto &setup = camera_->setup();
    std::string line = "videoconvert ! video/x-raw,format=I420 ! " + video + " ! queue ! qtmux name=mux ! filesink name=file";
    if (!aac.empty()) {
      line += " " + (setup.microphoneSource.empty() ? std::string("pulsesrc") : setup.microphoneSource) +
              " ! audioconvert ! audioresample ! " + aac + " ! queue ! mux.";
    }
    GError *failure = nullptr;
    GstElement *pipeline = gst_parse_launch(line.c_str(), &failure);
    if (!pipeline || failure) {
      done(failure ? failure->message : "the recording could not be made");
      g_clear_error(&failure);
      if (pipeline) {
        gst_object_unref(pipeline);
      }
      gst_object_unref(gst_object_ref_sink(source));
      if (fd >= 0) {
        close(fd);
      }
      return;
    }
    GstElement *convert = gst_bin_get_by_name(GST_BIN(pipeline), "videoconvert0");
    gst_bin_add(GST_BIN(pipeline), source);
    gst_element_link(source, convert);
    gst_object_unref(convert);
    GstElement *file = gst_bin_get_by_name(GST_BIN(pipeline), "file");
    gchar *folder = g_path_get_dirname(request.path.c_str());
    g_mkdir_with_parents(folder, 0700);
    g_free(folder);
    g_object_set(file, "location", request.path.c_str(), nullptr);
    gst_object_unref(file);
    auto r = std::make_unique<Recording>();
    r->pipeline = pipeline;
    r->fd = fd;
    r->path = request.path;
    r->maxFileSize = request.maxFileSize;
    r->started = g_get_monotonic_time();
    r->done = std::move(done);
    if (gst_element_set_state(pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
      auto answer = std::move(r->done);
      gst_element_set_state(pipeline, GST_STATE_NULL);
      gst_object_unref(pipeline);
      if (fd >= 0) {
        close(fd);
      }
      answer("the camera or the file " + request.path + " could not be opened");
      return;
    }
    auto *weak = new std::weak_ptr<GstCameraCapture>(weak_from_this());
    r->poll = g_timeout_add_full(G_PRIORITY_DEFAULT, 100, [](gpointer data) -> gboolean {
      auto self = static_cast<std::weak_ptr<GstCameraCapture> *>(data)->lock();
      return self && self->pollRecording() ? G_SOURCE_CONTINUE : G_SOURCE_REMOVE;
    }, weak, [](gpointer data) { delete static_cast<std::weak_ptr<GstCameraCapture> *>(data); });
    if (request.maxDuration > 0) {
      auto *limitWeak = new std::weak_ptr<GstCameraCapture>(weak_from_this());
      r->limit = g_timeout_add_full(G_PRIORITY_DEFAULT, static_cast<guint>(request.maxDuration * 1000), [](gpointer data) -> gboolean {
        if (auto self = static_cast<std::weak_ptr<GstCameraCapture> *>(data)->lock()) {
          self->stopRecording();
        }
        return G_SOURCE_REMOVE;
      }, limitWeak, [](gpointer data) { delete static_cast<std::weak_ptr<GstCameraCapture> *>(data); });
    }
    recording_ = std::move(r);
  }

  void stopRecording() override {
    std::lock_guard lock(mutex_);
    if (recording_ && !recording_->ending) {
      recording_->ending = true;
      // The muxer writes its index at the end of the stream: each live source ends it.
      gst_element_send_event(recording_->pipeline, gst_event_new_eos());
    }
  }

  bool recording() const override {
    std::lock_guard lock(mutex_);
    return recording_ != nullptr;
  }

 private:
  // On the main loop while recording: whether to keep polling.
  bool pollRecording() {
    std::string error;
    bool ended = false;
    {
      std::lock_guard lock(mutex_);
      if (!recording_) {
        return false;
      }
      GstBus *bus = gst_element_get_bus(recording_->pipeline);
      while (GstMessage *message = gst_bus_pop_filtered(bus, static_cast<GstMessageType>(GST_MESSAGE_EOS | GST_MESSAGE_ERROR))) {
        if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
          GError *failure = nullptr;
          gst_message_parse_error(message, &failure, nullptr);
          error = failure ? failure->message : "the recording failed";
          g_clear_error(&failure);
        }
        ended = true;
        gst_message_unref(message);
      }
      gst_object_unref(bus);
      struct stat file {};
      if (!ended && recording_->maxFileSize > 0 && !recording_->ending && stat(recording_->path.c_str(), &file) == 0 &&
          file.st_size >= recording_->maxFileSize) {
        recording_->ending = true;
        gst_element_send_event(recording_->pipeline, gst_event_new_eos());
      }
    }
    if (ended) {
      endRecording(false, error);
    }
    return !ended;
  }

  // Ends the recording: with `wait`, first carries the end of the stream through (bounded).
  void endRecording(bool wait, const std::string &error) {
    std::unique_ptr<Recording> r;
    {
      std::lock_guard lock(mutex_);
      r = std::move(recording_);
    }
    if (!r) {
      return;
    }
    if (wait) {
      gst_element_send_event(r->pipeline, gst_event_new_eos());
      GstBus *bus = gst_element_get_bus(r->pipeline);
      if (GstMessage *end = gst_bus_timed_pop_filtered(bus, 3 * GST_SECOND, static_cast<GstMessageType>(GST_MESSAGE_EOS | GST_MESSAGE_ERROR))) {
        gst_message_unref(end);
      }
      gst_object_unref(bus);
    }
    if (r->poll) {
      g_source_remove(r->poll);
    }
    if (r->limit) {
      g_source_remove(r->limit);
    }
    gst_element_set_state(r->pipeline, GST_STATE_NULL);
    gst_object_unref(r->pipeline);
    if (r->fd >= 0) {
      close(r->fd);
    }
    if (r->done) {
      r->done(error);
    }
  }

  std::shared_ptr<PortalCamera> camera_;
  GstElement *pipeline_;
  GstElement *sink_;
  int fd_;
  std::shared_ptr<Frames> frames_;
  mutable std::mutex mutex_;
  std::unique_ptr<Recording> recording_;
};

// A running camera from `hardware`, or null with `error` set.
std::shared_ptr<GstCameraCapture> startCapture(const std::shared_ptr<CameraHardware> &hardware, std::string &error) {
  auto camera = std::dynamic_pointer_cast<PortalCamera>(hardware);
  if (!camera) {
    error = "Camera could not be started";
    return nullptr;
  }
  int fd = -1;
  GstElement *source = camera->source(fd, error);
  if (!source) {
    return nullptr;
  }
  auto frames = std::make_shared<Frames>();
  GstElement *pipeline = GST_ELEMENT(gst_object_ref_sink(gst_pipeline_new(nullptr)));
  GstElement *convert = gst_element_factory_make("videoconvert", nullptr);
  GstElement *sink = GST_ELEMENT(gst_object_ref_sink(makeFrameSink(frames, false)));
  gst_bin_add_many(GST_BIN(pipeline), source, convert, sink, nullptr);
  auto capture = std::make_shared<GstCameraCapture>(camera, pipeline, sink, fd, frames);
  if (!gst_element_link_many(source, convert, sink, nullptr) ||
      gst_element_set_state(pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
    error = "Camera could not be started - its stream did not open.";
    return nullptr;
  }
  return capture;
}

std::shared_ptr<CameraHardware> gHardware;
std::shared_ptr<CameraViews> gViews;
bool gNoPrompts = false;

} // namespace

std::shared_ptr<CameraHardware> makeCameraHardware(CameraSetup setup) {
  if (!gstreamerHas({"videoconvert", "appsink"}) || (setup.source.empty() && !gstreamerHas({"pipewiresrc"}))) {
    return nullptr;
  }
  return std::make_shared<PortalCamera>(std::move(setup));
}

void useCameraHardware(std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, bool noPrompts) {
  gHardware = std::move(hardware);
  gViews = std::move(views);
  gNoPrompts = noPrompts;
}

// --- the view ------------------------------------------------------------------------------------

struct CameraSurface : std::enable_shared_from_this<CameraSurface> {
  GtkWidget *picture{nullptr};
  int tag{0};
  std::function<void(const std::string &, folly::dynamic)> send;
  std::shared_ptr<GstCameraCapture> capture;
  int watcher{-1};
  bool active{false};
  bool asking{false};
  bool asked{false};
  bool reported{false};
  // Which start a frame belongs to: a stop moves it on.
  uint64_t start{0};

  ~CameraSurface() {
    stop();
    if (picture) {
      if (gtk_widget_get_parent(picture)) {
        gtk_widget_unparent(picture);
      }
      g_object_unref(picture);
    }
  }

  void report(const std::string &message) {
    if (!reported) {
      reported = true;
      send("mountError", folly::dynamic::object("message", message));
    }
  }

  void stop() {
    start++;
    if (gViews) {
      gViews->detach(tag);
    }
    if (capture) {
      capture->frames()->unwatch(watcher);
      watcher = -1;
      capture = nullptr;
    }
    if (picture) {
      gtk_picture_set_paintable(GTK_PICTURE(picture), nullptr);
    }
  }

  void follow() {
    if (!active) {
      stop();
      return;
    }
    if (!gHardware || capture || asking) {
      return;
    }
    auto mount = cameraMount(gHardware->access(), gHardware->hasCamera(), gNoPrompts, asked);
    if (mount == CameraMount::Ask) {
      asking = true;
      asked = true;
      std::weak_ptr<CameraSurface> weak = weak_from_this();
      gHardware->requestAccess([weak](CameraHardware::Access) {
        auto *later = new std::weak_ptr<CameraSurface>(weak);
        g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer data) -> gboolean {
          if (auto self = static_cast<std::weak_ptr<CameraSurface> *>(data)->lock()) {
            self->asking = false;
            self->follow();
          }
          return G_SOURCE_REMOVE;
        }, later, [](gpointer data) { delete static_cast<std::weak_ptr<CameraSurface> *>(data); });
      });
      return;
    }
    if (mount != CameraMount::Start) {
      report(cameraMountError(mount));
      return;
    }
    std::string error;
    capture = startCapture(gHardware, error);
    if (!capture) {
      report(error);
      return;
    }
    uint64_t at = ++start;
    auto *self = this;
    watcher = capture->frames()->watch([self, at, first = true](GdkTexture *texture) mutable {
      gtk_picture_set_paintable(GTK_PICTURE(self->picture), texture ? GDK_PAINTABLE(texture) : nullptr);
      if (texture && first && self->start == at) {
        first = false;
        self->send("cameraReady", folly::dynamic::object());
      }
    });
    if (gViews) {
      gViews->attach(tag, capture);
    }
  }
};

std::shared_ptr<CameraSurface> makeCameraSurface(GtkWidget *view, int tag, std::function<void(const std::string &, folly::dynamic)> send) {
  auto s = std::make_shared<CameraSurface>();
  s->tag = tag;
  s->send = std::move(send);
  s->picture = GTK_WIDGET(g_object_ref_sink(gtk_picture_new()));
  gtk_picture_set_content_fit(GTK_PICTURE(s->picture), GTK_CONTENT_FIT_COVER);
  gtk_picture_set_can_shrink(GTK_PICTURE(s->picture), TRUE);
  gtk_widget_set_parent(s->picture, view);
  return s;
}

void applyCameraSurface(CameraSurface &s, const CameraProps &props) {
  // Set first, so the camera is never attached without it.
  if (gViews) {
    gViews->mute(s.tag, props.mute);
  }
  s.active = props.active;
  s.follow();
}

GtkWidget *cameraWidget(CameraSurface &s) {
  return s.picture;
}

GtkPicture *cameraPicture(CameraSurface &s) {
  return GTK_PICTURE(s.picture);
}

// --- the sheet -----------------------------------------------------------------------------------

namespace {

std::optional<CameraClip> clipOf(const std::string &path) {
  GstDiscoverer *discoverer = gst_discoverer_new(5 * GST_SECOND, nullptr);
  if (!discoverer) {
    return std::nullopt;
  }
  gchar *uri = g_filename_to_uri(path.c_str(), nullptr, nullptr);
  GstDiscovererInfo *info = uri ? gst_discoverer_discover_uri(discoverer, uri, nullptr) : nullptr;
  g_free(uri);
  std::optional<CameraClip> out;
  if (info) {
    GList *videos = gst_discoverer_info_get_video_streams(info);
    if (videos) {
      auto *video = GST_DISCOVERER_VIDEO_INFO(videos->data);
      out = CameraClip{.width = static_cast<int>(gst_discoverer_video_info_get_width(video)),
                       .height = static_cast<int>(gst_discoverer_video_info_get_height(video)),
                       .duration = static_cast<double>(gst_discoverer_info_get_duration(info)) / GST_MSECOND};
    }
    gst_discoverer_stream_info_list_free(videos);
    g_object_unref(info);
  }
  g_object_unref(discoverer);
  return out;
}

struct Sheet {
  CameraSheetRequest request;
  std::function<void(CameraTake, const std::string &)> done;
  std::shared_ptr<GstCameraCapture> capture;
  GtkWindow *window{nullptr};
  GtkWidget *shutter{nullptr};
  GtkWidget *cancel{nullptr};
  GtkWidget *photo{nullptr};
  GtkWidget *video{nullptr};
  int watcher{-1};
  bool videoMode{false};
  bool recording{false};
  bool answered{false};
  // False once the sheet has answered: a recording that ends after hears nothing.
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);

  void finish(CameraTake take, const std::string &error);
};

Sheet *gSheet = nullptr;

void Sheet::finish(CameraTake take, const std::string &error) {
  if (answered) {
    return;
  }
  answered = true;
  *alive = false;
  auto answer = std::move(done);
  if (capture) {
    capture->frames()->unwatch(watcher);
    // Let go on a later turn: the answer can come from inside the capture's own call.
    g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer) -> gboolean { return G_SOURCE_REMOVE; },
                    new std::shared_ptr<GstCameraCapture>(std::move(capture)),
                    [](gpointer data) { delete static_cast<std::shared_ptr<GstCameraCapture> *>(data); });
  }
  if (window) {
    g_signal_handlers_disconnect_by_data(window, this);
    gtk_window_destroy(std::exchange(window, nullptr));
  }
  if (gSheet == this) {
    gSheet = nullptr;
  }
  answer(std::move(take), error);
  delete this;
}

void updateShutter(Sheet &s) {
  gtk_button_set_label(GTK_BUTTON(s.shutter), !s.videoMode ? "Take Photo" : s.recording ? "Stop" : "Record");
  if (s.photo) {
    gtk_widget_set_sensitive(s.photo, !s.recording);
    gtk_widget_set_sensitive(s.video, !s.recording);
  }
}

void pressShutter(Sheet &s) {
  if (!s.capture) {
    return;
  }
  if (!s.videoMode) {
    s.capture->takePicture(s.request.photo, [&s](int width, int height, const std::string &error) {
      if (!error.empty()) {
        s.finish({}, error);
        return;
      }
      s.finish(CameraTake{.photo = CameraShot{.width = width, .height = height}}, "");
    });
    return;
  }
  if (s.recording) {
    s.capture->stopRecording();
    return;
  }
  s.recording = true;
  updateShutter(s);
  auto path = s.request.video.path;
  s.capture->startRecording(s.request.video, [&s, alive = s.alive, path](const std::string &error) {
    if (!*alive) {
      return;
    }
    if (!error.empty()) {
      s.finish({}, error);
      return;
    }
    auto clip = clipOf(path);
    s.finish(clip ? CameraTake{.video = *clip} : CameraTake{}, clip ? "" : "the recording has no video");
  });
}

void showSheet(CameraSheetRequest request, std::function<void(CameraTake, const std::string &)> done) {
  if (gSheet || !gHardware) {
    done({}, "");
    return;
  }
  std::string error;
  auto capture = startCapture(gHardware, error);
  if (!capture) {
    done({}, error);
    return;
  }
  auto *s = new Sheet{.request = std::move(request), .done = std::move(done), .capture = capture};
  s->videoMode = !s->request.photos && s->request.videos;
  gSheet = s;
  GtkWidget *window = gtk_window_new();
  s->window = GTK_WINDOW(window);
  gtk_window_set_title(s->window, "Camera");
  gtk_window_set_modal(s->window, TRUE);
  gtk_window_set_default_size(s->window, 640, 520);
  if (GtkWindow *front = portal::frontWindow()) {
    gtk_window_set_transient_for(s->window, front);
  }
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *picture = gtk_picture_new();
  gtk_picture_set_content_fit(GTK_PICTURE(picture), GTK_CONTENT_FIT_CONTAIN);
  gtk_widget_set_vexpand(picture, TRUE);
  gtk_box_append(GTK_BOX(box), picture);
  s->watcher = capture->frames()->watch([picture](GdkTexture *texture) {
    gtk_picture_set_paintable(GTK_PICTURE(picture), texture ? GDK_PAINTABLE(texture) : nullptr);
  });
  GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
  gtk_widget_set_margin_start(bar, 12);
  gtk_widget_set_margin_end(bar, 12);
  gtk_widget_set_margin_top(bar, 12);
  gtk_widget_set_margin_bottom(bar, 12);
  s->cancel = gtk_button_new_with_label("Cancel");
  g_signal_connect(s->cancel, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) { static_cast<Sheet *>(data)->finish({}, ""); }), s);
  gtk_box_append(GTK_BOX(bar), s->cancel);
  GtkWidget *middle = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
  gtk_widget_set_hexpand(middle, TRUE);
  gtk_widget_set_halign(middle, GTK_ALIGN_CENTER);
  if (s->request.photos && s->request.videos) {
    gtk_widget_add_css_class(middle, "linked");
    s->photo = gtk_toggle_button_new_with_label("Photo");
    s->video = gtk_toggle_button_new_with_label("Video");
    gtk_toggle_button_set_group(GTK_TOGGLE_BUTTON(s->video), GTK_TOGGLE_BUTTON(s->photo));
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(s->photo), TRUE);
    g_signal_connect(s->video, "toggled", G_CALLBACK(+[](GtkToggleButton *button, gpointer data) {
      auto &s = *static_cast<Sheet *>(data);
      s.videoMode = gtk_toggle_button_get_active(button);
      updateShutter(s);
    }), s);
    gtk_box_append(GTK_BOX(middle), s->photo);
    gtk_box_append(GTK_BOX(middle), s->video);
  }
  gtk_box_append(GTK_BOX(bar), middle);
  s->shutter = gtk_button_new_with_label("Take Photo");
  gtk_widget_add_css_class(s->shutter, "suggested-action");
  g_signal_connect(s->shutter, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) { pressShutter(*static_cast<Sheet *>(data)); }), s);
  gtk_box_append(GTK_BOX(bar), s->shutter);
  gtk_box_append(GTK_BOX(box), bar);
  gtk_window_set_child(s->window, box);
  gtk_window_set_default_widget(s->window, s->shutter);
  GtkEventController *keys = gtk_event_controller_key_new();
  g_signal_connect(keys, "key-pressed", G_CALLBACK(+[](GtkEventControllerKey *, guint key, guint, GdkModifierType, gpointer data) -> gboolean {
    if (key == GDK_KEY_Escape) {
      static_cast<Sheet *>(data)->finish({}, "");
      return TRUE;
    }
    return FALSE;
  }), s);
  gtk_widget_add_controller(window, keys);
  g_signal_connect(window, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer data) -> gboolean {
    static_cast<Sheet *>(data)->finish({}, "");
    return TRUE;
  }), s);
  updateShutter(*s);
  gtk_window_present(s->window);
}

class GtkCameraSheet final : public CameraSheet {
 public:
  void shoot(const CameraSheetRequest &request, std::function<void(CameraTake, const std::string &)> done) override {
    // On the main loop, whichever thread asks.
    auto *call = new std::function<void()>([request, done = std::move(done)]() mutable { showSheet(std::move(request), std::move(done)); });
    g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer data) -> gboolean {
      (*static_cast<std::function<void()> *>(data))();
      return G_SOURCE_REMOVE;
    }, call, [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
  }
};

} // namespace

std::shared_ptr<CameraSheet> makeCameraSheet() {
  return std::make_shared<GtkCameraSheet>();
}

GtkWindow *cameraSheetWindow() {
  return gSheet ? gSheet->window : nullptr;
}

GtkWidget *cameraSheetShutter() {
  return gSheet ? gSheet->shutter : nullptr;
}

GtkWidget *cameraSheetCancel() {
  return gSheet ? gSheet->cancel : nullptr;
}

} // namespace ngn::gtk
