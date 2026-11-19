// `<expo-camera>`, NgNativeCamera and ImagePicker's camera on Linux, over a test camera (a red
// test pattern) and a test tone for the microphone: a view mounted from Fabric mutations shows the
// camera, and the module takes its pictures and records it. The Camera portal half (access, a
// camera present and the PipeWire connection) is the media spike's to show, since no PipeWire
// camera runs in a container.
#if NGN_GSTREAMER
#include "../audio.h"
#include "../camera.h"
#include "helpers.h"
#include "mounted-views.h"

#include <doctest/doctest.h>
#include <gdk-pixbuf/gdk-pixbuf.h>
#include <gst/pbutils/pbutils.h>
#include <react/renderer/core/PropsParserContext.h>

#include <filesystem>
#include <optional>
#include <string>

using folly::dynamic;
using ngn::testing::MountedViews;

namespace {

constexpr facebook::react::Tag kCamera = 9;
constexpr const char *kRed = "videotestsrc is-live=true pattern=4 ! video/x-raw,width=64,height=48,framerate=30/1";

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-camera-" + std::to_string(getpid()));
  Folder() { std::filesystem::create_directories(path); }
  ~Folder() {
    std::error_code ignored;
    std::filesystem::remove_all(path, ignored);
  }
};

// The test camera, and the views the host would share, used for the test and dropped after it.
struct Camera {
  std::shared_ptr<ngn::AudioInput> microphone =
      ngn::gtk::makeAudioInput({.source = "audiotestsrc is-live=true", .microphone = [] { return true; }});
  std::shared_ptr<ngn::CameraHardware> hardware =
      ngn::gtk::makeCameraHardware({.source = kRed, .microphone = microphone, .microphoneSource = "audiotestsrc is-live=true"});
  std::shared_ptr<ngn::CameraViews> views = std::make_shared<ngn::CameraViews>();
  Camera() {
    REQUIRE(ngn::testing::gtkReady());
    REQUIRE(hardware);
    ngn::gtk::useCameraHardware(hardware, views, false);
  }
  ~Camera() { ngn::gtk::useCameraHardware(nullptr, nullptr, false); }
};

facebook::react::ShadowView cameraShadow(dynamic raw) {
  static auto context = std::make_shared<const facebook::react::ContextContainer>();
  static ngn::CameraComponentDescriptor descriptor({{}, context, nullptr});
  facebook::react::PropsParserContext parser{1, *context};
  return MountedViews::shadow(kCamera, ngn::CameraComponentName, descriptor.cloneProps(parser, nullptr, facebook::react::RawProps(std::move(raw))),
                              {{0, 0}, {160, 120}});
}

dynamic ask(ngn::NativeModule &module, const std::string &method, dynamic args) {
  std::optional<dynamic> answer;
  module.callWithPromise(method, args,
                         {.resolve = [&](dynamic v) { answer = v; }, .reject = [&](const std::string &m) { answer = dynamic::object("rejected", m); }});
  ngn::testing::runUntil([&] { return answer.has_value(); });
  return *answer;
}

struct Clip {
  int width{0}, height{0};
  bool sound{false};
  double seconds{0};
};
std::optional<Clip> discover(const std::string &path) {
  GstDiscoverer *discoverer = gst_discoverer_new(5 * GST_SECOND, nullptr);
  gchar *uri = g_filename_to_uri(path.c_str(), nullptr, nullptr);
  GstDiscovererInfo *info = gst_discoverer_discover_uri(discoverer, uri, nullptr);
  g_free(uri);
  std::optional<Clip> out;
  if (info && gst_discoverer_info_get_result(info) == GST_DISCOVERER_OK) {
    GList *videos = gst_discoverer_info_get_video_streams(info);
    GList *audios = gst_discoverer_info_get_audio_streams(info);
    if (videos) {
      auto *video = GST_DISCOVERER_VIDEO_INFO(videos->data);
      out = Clip{.width = static_cast<int>(gst_discoverer_video_info_get_width(video)),
                 .height = static_cast<int>(gst_discoverer_video_info_get_height(video)),
                 .sound = audios != nullptr,
                 .seconds = static_cast<double>(gst_discoverer_info_get_duration(info)) / GST_SECOND};
    }
    gst_discoverer_stream_info_list_free(videos);
    gst_discoverer_stream_info_list_free(audios);
  }
  if (info) {
    g_object_unref(info);
  }
  g_object_unref(discoverer);
  return out;
}

} // namespace

TEST_CASE("Camera on Linux shows a mounted view's camera, takes its pictures and records it, and stops as the view goes") {
  Camera camera;
  Folder folder;
  auto module = ngn::makeCameraModule(camera.hardware, camera.views, (folder.path / "Camera").string(), false);
  CHECK(ask(*module, "isAvailableAsync", dynamic::array()) == true);
  CHECK(ask(*module, "getCameraPermissionsAsync", dynamic::array())["granted"] == true);

  MountedViews views;
  views.add(cameraShadow(dynamic::object("active", true)));
  auto *d = ngn::gtk::viewData(views.view(kCamera));
  REQUIRE(d->camera);
  ngn::testing::runUntil([&] { return gtk_picture_get_paintable(ngn::gtk::cameraPicture(*d->camera)) != nullptr; });
  views.settle();
  auto shown = views.pixel(80, 60);
  CHECK(shown.r > 200);
  CHECK(shown.g < 60);
  REQUIRE(camera.views->find(kCamera));

  auto jpeg = ask(*module, "takePicture", dynamic::array(kCamera, dynamic::object("quality", 0.5)));
  REQUIRE_FALSE(jpeg.count("rejected"));
  CHECK(jpeg["width"] == 64);
  CHECK(jpeg["height"] == 48);
  std::string jpegPath = jpeg["uri"].asString().substr(7);
  GdkPixbufFormat *format = gdk_pixbuf_get_file_info(jpegPath.c_str(), nullptr, nullptr);
  REQUIRE(format);
  CHECK(std::string(gdk_pixbuf_format_get_name(format)) == "jpeg");
  auto png = ask(*module, "takePicture", dynamic::array(kCamera, dynamic::object("imageType", "png")));
  REQUIRE_FALSE(png.count("rejected"));
  format = gdk_pixbuf_get_file_info(png["uri"].asString().substr(7).c_str(), nullptr, nullptr);
  REQUIRE(format);
  CHECK(std::string(gdk_pixbuf_format_get_name(format)) == "png");

  // A recording, with sound, until it is stopped.
  std::optional<dynamic> recorded;
  module->callWithPromise("record", dynamic::array(kCamera, dynamic::object()),
                          {.resolve = [&](dynamic v) { recorded = v; }, .reject = [&](const std::string &m) { recorded = dynamic::object("rejected", m); }});
  gint64 until = g_get_monotonic_time() + 700 * 1000;
  ngn::testing::runUntil([&] { return g_get_monotonic_time() > until; });
  module->call("stopRecording", dynamic::array(kCamera));
  ngn::testing::runUntil([&] { return recorded.has_value(); });
  REQUIRE_FALSE(recorded->count("rejected"));
  auto clip = discover(recorded->at("uri").asString().substr(7));
  REQUIRE(clip);
  CHECK(clip->width == 64);
  CHECK(clip->height == 48);
  CHECK(clip->sound);
  CHECK(clip->seconds > 0.3);

  // A recording up to its maxDuration ends by itself.
  recorded.reset();
  module->callWithPromise("record", dynamic::array(kCamera, dynamic::object("maxDuration", 0.5)),
                          {.resolve = [&](dynamic v) { recorded = v; }, .reject = [&](const std::string &m) { recorded = dynamic::object("rejected", m); }});
  ngn::testing::runUntil([&] { return recorded.has_value(); });
  REQUIRE_FALSE(recorded->count("rejected"));

  // Inactive, the camera stops: the module finds none.
  views.update(views.mounting->tree().find(kCamera)->view, cameraShadow(dynamic::object("active", false)).props);
  CHECK_FALSE(camera.views->find(kCamera));
  CHECK(gtk_picture_get_paintable(ngn::gtk::cameraPicture(*d->camera)) == nullptr);
}

TEST_CASE("ImagePicker's camera on Linux takes a photo in its own dialog, and answers nothing when cancelled") {
  Camera camera;
  Folder folder;
  auto sheet = ngn::gtk::makeCameraSheet();
  ngn::CameraSheetRequest request;
  request.photo.path = (folder.path / "shot.jpg").string();
  std::optional<std::pair<ngn::CameraTake, std::string>> answer;
  sheet->shoot(request, [&](ngn::CameraTake take, const std::string &error) { answer.emplace(take, error); });
  ngn::testing::runUntil([] { return ngn::gtk::cameraSheetWindow() != nullptr; });
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(ngn::gtk::cameraSheetShutter()))) == "Take Photo");
  // Once the camera shows a frame, the shutter takes it.
  gint64 until = g_get_monotonic_time() + 300 * 1000;
  ngn::testing::runUntil([&] { return g_get_monotonic_time() > until; });
  g_signal_emit_by_name(ngn::gtk::cameraSheetShutter(), "clicked");
  ngn::testing::runUntil([&] { return answer.has_value(); });
  CHECK(answer->second.empty());
  REQUIRE(answer->first.photo);
  CHECK(answer->first.photo->width == 64);
  CHECK(std::filesystem::exists(request.photo.path));
  CHECK(ngn::gtk::cameraSheetWindow() == nullptr);

  answer.reset();
  sheet->shoot(request, [&](ngn::CameraTake take, const std::string &error) { answer.emplace(take, error); });
  ngn::testing::runUntil([] { return ngn::gtk::cameraSheetWindow() != nullptr; });
  g_signal_emit_by_name(ngn::gtk::cameraSheetCancel(), "clicked");
  REQUIRE(answer);
  CHECK_FALSE(answer->first.photo);
  CHECK_FALSE(answer->first.video);
  CHECK(answer->second.empty());
}

TEST_CASE("ImagePicker's camera on Linux records a video in its own dialog") {
  Camera camera;
  Folder folder;
  auto sheet = ngn::gtk::makeCameraSheet();
  ngn::CameraSheetRequest request;
  request.photos = false;
  request.videos = true;
  request.video.path = (folder.path / "clip.mov").string();
  std::optional<std::pair<ngn::CameraTake, std::string>> answer;
  sheet->shoot(request, [&](ngn::CameraTake take, const std::string &error) { answer.emplace(take, error); });
  ngn::testing::runUntil([] { return ngn::gtk::cameraSheetWindow() != nullptr; });
  GtkWidget *shutter = ngn::gtk::cameraSheetShutter();
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(shutter))) == "Record");
  g_signal_emit_by_name(shutter, "clicked");
  CHECK(std::string(gtk_button_get_label(GTK_BUTTON(shutter))) == "Stop");
  gint64 until = g_get_monotonic_time() + 600 * 1000;
  ngn::testing::runUntil([&] { return g_get_monotonic_time() > until; });
  g_signal_emit_by_name(shutter, "clicked");
  ngn::testing::runUntil([&] { return answer.has_value(); });
  CHECK(answer->second.empty());
  REQUIRE(answer->first.video);
  CHECK(answer->first.video->width == 64);
  CHECK(answer->first.video->duration > 300);
}
#endif
