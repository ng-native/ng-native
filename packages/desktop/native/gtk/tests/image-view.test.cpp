// An Image mounted into GTK: its source read through the core's loader, decoded by GDK and drawn
// where its resizeMode puts it, cut to the view's shape. Read from the pixels the window draws.
#include "../image-view.h"
#include "mounted-views.h"

#include "fake-network.h"
#include "ngn/curl-network.h"

#include <react/renderer/components/image/ImageComponentDescriptor.h>

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::MountedViews;
using ngn::testing::greenish;
using ngn::testing::reddish;

namespace {

constexpr int64_t kGreen = 0xff00ff00;

// Two red pixels side by side: twice as wide as it is high.
constexpr const char *kWideRed =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwH4QBEfcD/ePF9e8AAAAASUVORK5CYII=";

Props::Shared imageProps(dynamic raw) {
  return ngn::testing::parsedProps<ImageComponentDescriptor>(std::move(raw));
}

dynamic source(const std::string &uri) {
  return dynamic::array(dynamic::object("uri", uri)("scale", 1));
}

// The host's loading set for a test, and taken away after it.
struct ImageLoading {
  ImageLoading() {
    ngn::gtk::useImageLoading(ngn::makeCurlNetwork().http, std::make_shared<ngn::ImageCache>("", 1 << 20));
  }
  ~ImageLoading() {
    ngn::gtk::useImageLoading(nullptr, nullptr);
  }
  ImageLoading(const ImageLoading &) = delete;
  ImageLoading &operator=(const ImageLoading &) = delete;
};

// kWideRed's bytes.
std::string widePng() {
  std::string base64 = std::string(kWideRed).substr(std::string(kWideRed).find(',') + 1);
  gsize length = 0;
  guchar *png = g_base64_decode(base64.c_str(), &length);
  std::string bytes(reinterpret_cast<char *>(png), length);
  g_free(png);
  return bytes;
}

// Waits for the view's load to answer, then for it to be drawn.
void waitForLoad(MountedViews &views, Tag tag) {
  ngn::testing::runUntil([&] {
    auto *data = ngn::gtk::viewData(views.view(tag));
    return data && data->image && (data->image->texture || !data->image->error.empty());
  });
  views.settle();
}

} // namespace

TEST_CASE("an Image draws its source where its resizeMode puts it") {
  REQUIRE(ngn::testing::gtkReady());
  ImageLoading loading;
  MountedViews views;
  auto image = MountedViews::shadow(2, "Image", imageProps(dynamic::object("source", source(kWideRed))("resizeMode", "contain")), {{0, 0}, {100, 100}});
  views.add(image);
  waitForLoad(views, 2);
  auto *data = ngn::gtk::viewData(views.view(2));
  REQUIRE(data->image->texture);
  CHECK(gdk_texture_get_width(data->image->texture) == 2);
  // Contained: a band 50 high across the middle, nothing above or below it.
  CHECK(reddish(views.pixel(50, 50)));
  CHECK(views.pixel(50, 10).a == 0);
  CHECK(views.pixel(50, 90).a == 0);

  // Covering: the whole view.
  views.update(image, imageProps(dynamic::object("source", source(kWideRed))("resizeMode", "cover")));
  CHECK(reddish(views.pixel(50, 10)));
  CHECK(reddish(views.pixel(50, 90)));

  // Centred at its own size: two points across the middle.
  views.update(image, imageProps(dynamic::object("source", source(kWideRed))("resizeMode", "center")));
  CHECK(views.pixel(50, 10).a == 0);
  CHECK(views.pixel(10, 50).a == 0);
}

TEST_CASE("an Image is cut to its view's rounded shape") {
  REQUIRE(ngn::testing::gtkReady());
  ImageLoading loading;
  MountedViews views;
  dynamic props = dynamic::object("source", source(kWideRed))("resizeMode", "cover")("borderRadius", 50);
  views.add(MountedViews::shadow(2, "Image", imageProps(props), {{0, 0}, {100, 100}}));
  waitForLoad(views, 2);
  CHECK(reddish(views.pixel(50, 50)));
  CHECK(views.pixel(3, 3).a < 40);
  CHECK(views.pixel(96, 96).a < 40);
}

TEST_CASE("an Image's border is drawn over its image, as a layer's border is") {
  REQUIRE(ngn::testing::gtkReady());
  ImageLoading loading;
  MountedViews views;
  dynamic props = dynamic::object("source", source(kWideRed))("resizeMode", "cover")("borderWidth", 10)("borderColor", 0xff0000ff);
  views.add(MountedViews::shadow(2, "Image", imageProps(props), {{0, 0}, {100, 100}}));
  waitForLoad(views, 2);
  CHECK(reddish(views.pixel(50, 50)));
  CHECK(ngn::testing::bluish(views.pixel(4, 50)));
  CHECK(ngn::testing::bluish(views.pixel(50, 95)));
}

TEST_CASE("an Image loads again for a new source, shows nothing for none, and says why one failed") {
  REQUIRE(ngn::testing::gtkReady());
  ImageLoading loading;
  MountedViews views;
  auto image = MountedViews::shadow(2, "Image", imageProps(dynamic::object("source", source(kWideRed))("resizeMode", "cover")), {{0, 0}, {100, 100}});
  views.add(image);
  waitForLoad(views, 2);
  auto *data = ngn::gtk::viewData(views.view(2));
  uint64_t turn = data->image->turn;

  // The same source again is not a new load.
  views.update(image, imageProps(dynamic::object("source", source(kWideRed))("resizeMode", "contain")));
  CHECK(data->image->turn == turn);

  // With none, only the view's own background shows.
  views.update(image, imageProps(dynamic::object("resizeMode", "cover")("backgroundColor", kGreen)));
  CHECK(data->image->turn == turn + 1);
  CHECK_FALSE(data->image->texture);
  CHECK(greenish(views.pixel(50, 50)));

  views.update(image, imageProps(dynamic::object("source", source("data:image/png;base64,AAAA"))("resizeMode", "cover")));
  waitForLoad(views, 2);
  CHECK_FALSE(data->image->texture);
  CHECK(data->image->error.starts_with("Could not decode the image"));

  views.update(image, imageProps(dynamic::object("source", source("content://nowhere"))("resizeMode", "cover")));
  CHECK(data->image->error == "Invalid image URL: content://nowhere");
}

TEST_CASE("an Image's late answer for a source it no longer shows is dropped") {
  REQUIRE(ngn::testing::gtkReady());
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::gtk::useImageLoading(http, nullptr);
  struct Restore {
    ~Restore() {
      ngn::gtk::useImageLoading(nullptr, nullptr);
    }
  } restore;
  MountedViews views;
  auto image = MountedViews::shadow(2, "Image", imageProps(dynamic::object("source", source("https://example.com/a.png"))), {{0, 0}, {100, 100}});
  views.add(image);
  REQUIRE(http->sent.size() == 1);
  // Taken away before its load answers: the answer, when it comes, shows nothing.
  views.update(image, imageProps(dynamic::object("backgroundColor", kGreen)));
  gsize length = 0;
  guchar *png = g_base64_decode(std::string(kWideRed).substr(std::string(kWideRed).find(',') + 1).c_str(), &length);
  auto &callbacks = http->sent[0]->callbacks;
  callbacks.onResponse({.status = 200});
  callbacks.onData(std::string(reinterpret_cast<char *>(png), length), -1);
  callbacks.onComplete("", false);
  g_free(png);
  views.settle();
  auto *data = ngn::gtk::viewData(views.view(2));
  CHECK_FALSE(data->image->texture);
  CHECK(greenish(views.pixel(50, 50)));
}

TEST_CASE("an Image decodes bytes the cache held off the UI thread, and answers in a later turn") {
  REQUIRE(ngn::testing::gtkReady());
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::gtk::useImageLoading(http, std::make_shared<ngn::ImageCache>("", 1 << 20));
  struct Restore {
    ~Restore() {
      ngn::gtk::useImageLoading(nullptr, nullptr);
    }
  } restore;
  MountedViews views;
  auto props = imageProps(dynamic::object("source", source("https://example.com/wide.png")));
  views.add(MountedViews::shadow(2, "Image", props, {{0, 0}, {100, 100}}));
  REQUIRE(http->sent.size() == 1);
  auto &callbacks = http->sent[0]->callbacks;
  callbacks.onResponse({.status = 200});
  callbacks.onData(widePng(), -1);
  callbacks.onComplete("", false);
  waitForLoad(views, 2);
  REQUIRE(ngn::gtk::viewData(views.view(2))->image->texture);

  // The same source again, from the cache: nothing is decoded or answered while the view is made.
  views.backend->createView(MountedViews::shadow(3, "Image", props, {{0, 0}, {100, 100}}));
  auto *data = ngn::gtk::viewData(views.view(3));
  CHECK(http->sent.size() == 1);
  CHECK_FALSE(data->image->texture);
  CHECK(data->image->error.empty());
  ngn::testing::runUntil([data] { return data->image->texture || !data->image->error.empty(); });
  REQUIRE(data->image->texture);
  CHECK(gdk_texture_get_width(data->image->texture) == 2);
  views.backend->deleteView(MountedViews::kSurface, 3);
}
