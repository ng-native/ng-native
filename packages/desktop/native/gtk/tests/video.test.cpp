// NgNativeVideo and `<expo-video>`'s view on Linux: a player made through the core's module, its
// frames shown in a view mounted from Fabric mutations through the GTK backend, its controls and
// full screen. VP9 in WebM, which el9's own plugins decode, with sound into a fake sink.
#if NGN_GSTREAMER
#include "../gst-playback.h"
#include "../gst-frames.h"
#include "../video.h"
#include "helpers.h"
#include "mounted-views.h"
#include "ngn/file-system.h"

#include <doctest/doctest.h>
#include <gst/gst.h>
#include <react/renderer/core/PropsParserContext.h>

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

using folly::dynamic;
using ngn::testing::MountedViews;

namespace {

struct Folder {
  // With a space, as a home folder's name can have.
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn video-" + std::to_string(getpid()));
  Folder() { std::filesystem::create_directories(path); }
  ~Folder() {
    std::error_code ignored;
    std::filesystem::remove_all(path, ignored);
  }
};

// A WebM of `frames` frames at 30 a second, 64 by 48, all of `pattern` (videotestsrc's: 4 red,
// 5 green, 6 blue), with a tone under it.
std::string videoFile(const Folder &folder, const char *name, int frames, int pattern, const char *aspect = "1/1") {
  auto path = (folder.path / name).string();
  std::string line = "webmmux name=mux ! filesink name=file videotestsrc num-buffers=" + std::to_string(frames) +
                     " pattern=" + std::to_string(pattern) +
                     " ! video/x-raw,width=64,height=48,framerate=30/1,pixel-aspect-ratio=" + aspect +
                     " ! vp9enc deadline=1 ! mux. audiotestsrc num-buffers=" +
                     std::to_string(frames * 48000 / 30 / 1024) + " ! audio/x-raw,rate=48000,channels=1 ! opusenc ! mux.";
  REQUIRE(ngn::gtk::gstreamerHas({}));
  GError *error = nullptr;
  GstElement *pipeline = gst_parse_launch(line.c_str(), &error);
  REQUIRE_MESSAGE(error == nullptr, (error ? error->message : ""));
  // Set, never parsed in the line.
  GstElement *file = gst_bin_get_by_name(GST_BIN(pipeline), "file");
  g_object_set(file, "location", path.c_str(), nullptr);
  gst_object_unref(file);
  gst_element_set_state(pipeline, GST_STATE_PLAYING);
  GstBus *bus = gst_element_get_bus(pipeline);
  GstMessage *end = gst_bus_timed_pop_filtered(bus, 20 * GST_SECOND, static_cast<GstMessageType>(GST_MESSAGE_EOS | GST_MESSAGE_ERROR));
  bool ended = end && GST_MESSAGE_TYPE(end) == GST_MESSAGE_EOS;
  if (end) {
    gst_message_unref(end);
  }
  gst_object_unref(bus);
  gst_element_set_state(pipeline, GST_STATE_NULL);
  gst_object_unref(pipeline);
  REQUIRE(ended);
  return ngn::fileUri(path);
}

facebook::react::Props::Shared videoProps(dynamic raw) {
  static auto context = std::make_shared<const facebook::react::ContextContainer>();
  static ngn::VideoViewComponentDescriptor descriptor({{}, context, nullptr});
  facebook::react::PropsParserContext parser{1, *context};
  return descriptor.cloneProps(parser, nullptr, facebook::react::RawProps(std::move(raw)));
}

struct Players {
  std::shared_ptr<ngn::NativeModule> module;
  std::vector<dynamic> events;
  Players() {
    auto output = ngn::gtk::makeVideoOutput("fakesink");
    REQUIRE(output);
    module = ngn::makeVideoModule(output, ngn::testing::readsEverywhere());
    module->setEmitter([this](const std::string &, dynamic body) { events.push_back(std::move(body)); });
  }
  dynamic call(const std::string &method, dynamic args) { return module->call(method, args); }
  dynamic state(const dynamic &id) { return call("state", dynamic::array(id)); }
  int count(const char *type) {
    int n = 0;
    for (auto &event : events) {
      n += event["type"] == type;
    }
    return n;
  }
};

constexpr facebook::react::Tag kVideo = 7;

facebook::react::ShadowView videoShadow(dynamic raw, int width = 160, int height = 120) {
  return MountedViews::shadow(kVideo, ngn::VideoViewComponentName, videoProps(std::move(raw)),
                              {{0, 0}, {static_cast<facebook::react::Float>(width), static_cast<facebook::react::Float>(height)}});
}

ngn::gtk::ViewData *videoView(MountedViews &views) {
  GtkWidget *widget = views.view(kVideo);
  return widget ? ngn::gtk::viewData(widget) : nullptr;
}

// The middle pixel of what the view's picture shows, or nothing.
std::optional<ngn::testing::Pixel> shownPixel(GtkPicture *picture) {
  GdkPaintable *paintable = gtk_picture_get_paintable(picture);
  if (!paintable || !GDK_IS_TEXTURE(paintable)) {
    return std::nullopt;
  }
  GdkTexture *texture = GDK_TEXTURE(paintable);
  int width = gdk_texture_get_width(texture), height = gdk_texture_get_height(texture);
  std::vector<guchar> data(width * height * 4);
  gdk_texture_download(texture, data.data(), width * 4);
  const guchar *p = &data[((height / 2) * width + width / 2) * 4];
  // GDK downloads premultiplied BGRA on little-endian machines (GDK_MEMORY_DEFAULT).
  return ngn::testing::Pixel{p[2], p[1], p[0], p[3]};
}

} // namespace

TEST_CASE("Video on Linux plays a source into the view that names its player, sending its first frame once") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 30, 4);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  ngn::testing::runUntil([&] { return players.state(id)["status"] == "readyToPlay"; });
  CHECK(players.state(id)["duration"].asDouble() == doctest::Approx(1.0).epsilon(0.1));

  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id)("nativeControls", false), 160, 120));
  auto *d = videoView(views);
  REQUIRE(d);
  REQUIRE(d->video);
  GtkPicture *picture = ngn::gtk::videoPicture(*d->video);
  CHECK(ngn::gtk::videoPlayButton(*d->video) == nullptr);
  // The paused source's first frame, prerolled, is shown before it plays.
  ngn::testing::runUntil([&] { return shownPixel(picture).has_value(); });
  auto pixel = *shownPixel(picture);
  CHECK(pixel.r > 200);
  CHECK(pixel.g < 60);
  CHECK(pixel.b < 60);
  // Filling the view, and drawn in its window.
  CHECK(gtk_widget_get_width(GTK_WIDGET(picture)) == 160);
  views.settle();
  auto drawn = views.pixel(80, 60);
  CHECK(drawn.r > 200);
  CHECK(drawn.g < 60);

  players.call("play", dynamic::array(id));
  ngn::testing::runUntil([&] { return players.count("playToEnd") == 1; });
  CHECK(players.state(id)["playing"] == false);
  CHECK(players.count("timeUpdate") == 0);
}

TEST_CASE("Video on Linux shows a replaced source's frames, and nothing for a player released") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 15, 4);
  auto blue = videoFile(folder, "blue.webm", 15, 6);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id), 160, 120));
  GtkPicture *picture = ngn::gtk::videoPicture(*videoView(views)->video);
  ngn::testing::runUntil([&] { return shownPixel(picture) && shownPixel(picture)->r > 200; });
  players.call("replace", dynamic::array(id, blue));
  ngn::testing::runUntil([&] { return shownPixel(picture) && shownPixel(picture)->b > 200; });
  players.call("release", dynamic::array(id));
  ngn::testing::runUntil([&] { return !shownPixel(picture).has_value(); });
}

TEST_CASE("Video on Linux's controls play and pause the player, as the module hears") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 90, 4);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id), 200, 150));
  GtkWidget *button = ngn::gtk::videoPlayButton(*videoView(views)->video);
  REQUIRE(button);
  ngn::testing::runUntil([&] { return players.state(id)["status"] == "readyToPlay"; });
  g_signal_emit_by_name(button, "clicked");
  ngn::testing::runUntil([&] { return players.state(id)["playing"] == true && players.count("playingChange") >= 1; });
  ngn::testing::runUntil([&] { return std::string(gtk_button_get_icon_name(GTK_BUTTON(button))) == "media-playback-pause-symbolic"; });
  g_signal_emit_by_name(button, "clicked");
  ngn::testing::runUntil([&] { return players.state(id)["playing"] == false && players.count("playingChange") >= 2; });
}

TEST_CASE("Video on Linux goes full screen in a window of its own, sends both events, and leaves it with Escape or as the view goes") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 15, 4);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id), 160, 120));
  ngn::testing::SentEvents<facebook::react::ViewEventEmitter> sent(*videoView(views));
  auto &video = *videoView(views)->video;
  ngn::gtk::setVideoFullscreen(video, true);
  GtkWindow *window = ngn::gtk::videoFullscreenWindow(video);
  REQUIRE(window);
  CHECK(gtk_window_get_transient_for(window) == GTK_WINDOW(views.window));
  // Its own picture shows the same frames.
  GtkPicture *full = GTK_PICTURE(gtk_window_get_child(window));
  ngn::testing::runUntil([&] { return shownPixel(full) && shownPixel(full)->r > 200; });
  // Closing it leaves, as Escape does.
  gtk_window_close(window);
  CHECK(ngn::gtk::videoFullscreenWindow(video) == nullptr);
  CHECK(sent.count("topFullscreenEnter") == 1);
  CHECK(sent.count("topFullscreenExit") == 1);

  ngn::gtk::setVideoFullscreen(video, true);
  REQUIRE(ngn::gtk::videoFullscreenWindow(video));
  auto mounted = views.mounting->tree().find(kVideo)->view;
  views.mount({facebook::react::ShadowViewMutation::RemoveMutation(MountedViews::kSurface, mounted, 0),
               facebook::react::ShadowViewMutation::DeleteMutation(mounted)});
  // The view went: so did its window, and no list of windows still holds it.
  ngn::testing::runUntil([&] {
    GListModel *toplevels = gtk_window_get_toplevels();
    for (guint i = 0; i < g_list_model_get_n_items(toplevels); ++i) {
      auto *each = static_cast<GtkWindow *>(g_list_model_get_item(toplevels, i));
      bool found = each != GTK_WINDOW(views.window) && gtk_window_get_transient_for(each) == GTK_WINDOW(views.window);
      g_object_unref(each);
      if (found) {
        return false;
      }
    }
    return true;
  });
}
TEST_CASE("Video on Linux sends a view mounted over a paused player's frame its first frame, through the view") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 15, 4);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id), 160, 120));
  GtkPicture *first = ngn::gtk::videoPicture(*videoView(views)->video);
  ngn::testing::runUntil([&] { return shownPixel(first).has_value(); });
  // A second view of the same player, its emitter there as it is made.
  ngn::testing::SentEvents<facebook::react::ViewEventEmitter> sent;
  auto shadow = MountedViews::shadow(kVideo + 1, ngn::VideoViewComponentName, videoProps(dynamic::object("player", id)), {{0, 0}, {80, 60}});
  shadow.eventEmitter = sent.emitter;
  views.add(shadow);
  CHECK(sent.count("topFirstFrameRender") == 1);
}

TEST_CASE("Video on Linux shows an anamorphic source in square pixels") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto wide = videoFile(folder, "wide.webm", 15, 4, "2/1");
  Players players;
  auto id = players.call("createPlayer", dynamic::array(wide));
  MountedViews views;
  views.add(videoShadow(dynamic::object("player", id), 160, 120));
  GtkPicture *picture = ngn::gtk::videoPicture(*videoView(views)->video);
  ngn::testing::runUntil([&] { return shownPixel(picture).has_value(); });
  auto *texture = GDK_TEXTURE(gtk_picture_get_paintable(picture));
  CHECK(gdk_texture_get_width(texture) == 2 * gdk_texture_get_height(texture) * 64 / 48);
}

TEST_CASE("Video on Linux keeps a playing source's place when pitch preservation changes") {
  REQUIRE(ngn::testing::gtkReady());
  Folder folder;
  auto red = videoFile(folder, "red.webm", 90, 4);
  Players players;
  auto id = players.call("createPlayer", dynamic::array(red));
  ngn::testing::runUntil([&] { return players.state(id)["status"] == "readyToPlay"; });
  players.call("play", dynamic::array(id));
  ngn::testing::runUntil([&] { return players.state(id)["currentTime"].asDouble() > 0.5; });
  players.call("setPreservesPitch", dynamic::array(id, false));
  ngn::testing::runUntil([&] { return players.state(id)["status"] == "readyToPlay" && players.state(id)["currentTime"].asDouble() > 0.4; });
  CHECK(players.state(id)["playing"] == true);
}

TEST_CASE("Video on Linux's player fails a source with no video sink, rather than playing its sound alone") {
  REQUIRE(ngn::gtk::gstreamerHas({}));
  Folder folder;
  auto red = videoFile(folder, "red.webm", 15, 4);
  ngn::gtk::Playback playback(red, {.audioSink = "fakesink", .videoSink = nullptr, .video = true}, [](ngn::gtk::Playback::Change) {});
  auto state = playback.state();
  CHECK(state.load == ngn::gtk::PlaybackState::Load::Failed);
  CHECK(state.error.find("appsink") != std::string::npos);
}

TEST_CASE("Video on Linux's frames tell the watchers of a clear before the next source's frame, and skip one unwatched") {
  REQUIRE(ngn::testing::gtkReady());
  auto frames = std::make_shared<ngn::gtk::Frames>();
  std::vector<std::string> heard;
  int second = -1;
  frames->watch([&](GdkTexture *texture) {
    heard.push_back(texture ? "frame" : "clear");
    frames->unwatch(second);
  });
  second = frames->watch([&](GdkTexture *) { heard.push_back("second"); });
  auto texture = [] {
    guchar pixel[4] = {255, 0, 0, 255};
    GBytes *bytes = g_bytes_new(pixel, 4);
    GdkTexture *made = gdk_memory_texture_new(1, 1, GDK_MEMORY_R8G8B8A8, bytes, 4);
    g_bytes_unref(bytes);
    return made;
  };
  // A source ends and the next one's first frame comes before the main loop runs.
  ngn::gtk::Frames::post(frames, nullptr);
  ngn::gtk::Frames::post(frames, texture());
  ngn::testing::runUntil([&] { return heard.size() >= 2; });
  CHECK(heard == std::vector<std::string>{"clear", "frame"});
  CHECK(frames->shown() != nullptr);
}
#endif
