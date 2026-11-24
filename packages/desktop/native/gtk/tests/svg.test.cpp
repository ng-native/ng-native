// An svg mounted into GTK: its document, which the core builds from react-native-svg's elements,
// drawn by the cairo canvas into the svg view's snapshot. Read from the pixels the window draws.
#include "../cairo-canvas.h"
#include "../image-view.h"
#include "../svg-icon.h"
#include "fake-network.h"
#include "mounted-views.h"

#include <doctest/doctest.h>

#include <cstdlib>
#include <optional>
#include <string>

using namespace facebook::react;
using folly::dynamic;
using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::greenish;
using ngn::testing::MountedViews;
using ngn::testing::reddish;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}

SvgLength pct(double v) {
  return {.value = v, .unit = SvgLength::Unit::Percent, .set = true};
}

SvgBrush color(uint32_t argb) {
  return {.type = SvgBrush::Type::Color, .argb = argb};
}

SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}

// An svg with a 24 by 24 viewBox, as an icon's.
SvgElement icon() {
  SvgElement e{.kind = SvgKind::Svg};
  e.vbWidth = 24;
  e.vbHeight = 24;
  e.align = "xMidYMid";
  return e;
}

SvgElement rect(double x, double y, double w, double h, std::optional<uint32_t> fill = std::nullopt) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  if (fill) {
    e.fill = color(*fill);
    e.propList = {"fill"};
  }
  return e;
}

// An svg view of 96 by 96 at (0, 0), drawing `root`.
void mountSvg(MountedViews &views, SvgNode root) {
  views.add(MountedViews::shadow(2, "RNSVGSvgView", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}}));
  views.backend->setSvgDrawing(MountedViews::kSurface, 2, std::make_shared<const ngn::SvgDocument>(ngn::SvgDocument{.root = std::move(root)}));
  views.settle();
}

// The image load `http` sent as `index`, by default the last, answered with `bytes` or, when empty,
// an error.
void answer(ngn::testing::FakeHttp &http, const std::string &bytes, int index = -1) {
  REQUIRE_FALSE(http.sent.empty());
  auto &callbacks = http.sent[index < 0 ? http.sent.size() - 1 : static_cast<size_t>(index)]->callbacks;
  if (bytes.empty()) {
    callbacks.onComplete("unreachable", false);
  } else {
    callbacks.onResponse({.status = 200});
    callbacks.onData(bytes, -1);
    callbacks.onComplete("", false);
  }
}

// Draws an svg <image> of `uri` on a cairo canvas of its own, as an svg view's snapshot does. When
// its load ends, loaded or failed, `ended` counts it: the cache keeps the count alive past a test
// that gave up waiting. The canvas notes the image in `hold`, when given.
void drawImage(const std::string &uri, std::shared_ptr<int> ended = nullptr, ngn::gtk::SvgImageHold *hold = nullptr) {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  std::function<void()> told = ended ? std::function<void()>([ended] { ++*ended; }) : nullptr;
  ngn::gtk::makeCairoCanvas(cr, 10, 10, 1, told, hold)->image(uri, {0, 0, 10, 10}, "xMidYMid", 0, 1);
  cairo_destroy(cr);
  cairo_surface_destroy(surface);
}

// A PNG of `width` by `height` pixels of one colour, as GDK's default format holds it.
std::string pngOf(int width, int height, uint32_t argb) {
  std::vector<uint32_t> pixels(static_cast<size_t>(width) * height, argb);
  GBytes *data = g_bytes_new(pixels.data(), pixels.size() * 4);
  GdkTexture *texture = gdk_memory_texture_new(width, height, GDK_MEMORY_DEFAULT, data, static_cast<gsize>(width) * 4);
  g_bytes_unref(data);
  GBytes *bytes = gdk_texture_save_to_png_bytes(texture);
  g_object_unref(texture);
  std::string out(static_cast<const char *>(g_bytes_get_data(bytes, nullptr)), g_bytes_get_size(bytes));
  g_bytes_unref(bytes);
  return out;
}

} // namespace

TEST_CASE("an svg draws its shapes, scaled from its viewBox to its view") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountSvg(views, node(icon(), {node(rect(0, 0, 12, 24, 0xffff0000)), node(rect(12, 0, 12, 24, 0xff0000ff))}));
  // Each half of the viewBox is half the view: 48 points.
  CHECK(reddish(views.pixel(20, 48)));
  CHECK(reddish(views.pixel(44, 48)));
  CHECK(bluish(views.pixel(52, 48)));
  CHECK(bluish(views.pixel(90, 48)));
}

TEST_CASE("an svg strokes a path in an icon's line, in currentColor") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement line{.kind = SvgKind::Path};
  line.d = "M4 12H20";
  line.stroke = {.type = SvgBrush::Type::CurrentColor};
  line.fill = {.type = SvgBrush::Type::None};
  line.strokeWidth = len(4);
  line.strokeLinecap = 1;
  line.propList = {"stroke", "fill", "strokeWidth", "strokeLinecap"};
  auto root = icon();
  root.color = 0xff00ff00;
  mountSvg(views, node(root, {node(line)}));
  CHECK(greenish(views.pixel(48, 48)));
  // The round cap reaches past the end by half the width: 2 units, 8 points.
  CHECK(greenish(views.pixel(84, 48)));
  CHECK(views.pixel(48, 30).a == 0);
  CHECK(views.pixel(94, 48).a == 0);
}

TEST_CASE("an svg fills with a gradient, and draws a group at its opacity") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement gradient{.kind = SvgKind::LinearGradient, .name = "g"};
  gradient.lengths = {{"x1", pct(0)}, {"y1", pct(0)}, {"x2", pct(100)}, {"y2", pct(0)}};
  gradient.stops = {{0, 0xffff0000}, {1, 0xff0000ff}};
  auto filled = rect(0, 0, 24, 12);
  filled.fill = {.type = SvgBrush::Type::Ref, .ref = "g"};
  filled.propList = {"fill"};
  SvgElement group{.kind = SvgKind::Group};
  group.opacity = 0.5;
  mountSvg(views, node(icon(), {node({.kind = SvgKind::Defs}, {node(gradient)}), node(filled), node(group, {node(rect(0, 12, 24, 12, 0xff00ff00))})}));
  CHECK(reddish(views.pixel(2, 20)));
  CHECK(bluish(views.pixel(93, 20)));
  auto half = views.pixel(48, 72);
  CHECK(half.g > 200);
  CHECK(half.a > 100);
  CHECK(half.a < 160);
}

TEST_CASE("an svg draws an element through its mask") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  mask.units = 1;
  mask.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  auto masked = rect(0, 0, 24, 24, 0xffff0000);
  masked.mask = "m";
  // White shows the element, black hides it.
  mountSvg(views, node(icon(), {node(mask, {node(rect(0, 0, 12, 24, 0xffffffff)), node(rect(12, 0, 12, 24, 0xff000000))}), node(masked)}));
  CHECK(reddish(views.pixel(24, 48)));
  CHECK(views.pixel(72, 48).a < 20);
}

TEST_CASE("an svg cuts an element to its clip path, and fills with a pattern's tiles") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement clip{.kind = SvgKind::ClipPath, .name = "c"};
  auto clipped = rect(0, 0, 24, 12, 0xffff0000);
  clipped.clipPath = "c";
  // A pattern of 6 by 12 tiles, each green on its left half only.
  SvgElement pattern{.kind = SvgKind::Pattern, .name = "p"};
  pattern.units = 1;
  pattern.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(6)}, {"height", len(12)}};
  auto tiled = rect(0, 12, 24, 12);
  tiled.fill = {.type = SvgBrush::Type::Ref, .ref = "p"};
  tiled.propList = {"fill"};
  mountSvg(views, node(icon(), {node(clip, {node(rect(0, 0, 12, 12))}), node(clipped), node(pattern, {node(rect(0, 0, 3, 12, 0xff00ff00))}), node(tiled)}));
  CHECK(reddish(views.pixel(24, 24)));
  CHECK(views.pixel(72, 24).a == 0);
  // Tiles every 24 points, green for the first 12 of each.
  CHECK(greenish(views.pixel(6, 72)));
  CHECK(views.pixel(18, 72).a == 0);
  CHECK(greenish(views.pixel(30, 72)));
  CHECK(greenish(views.pixel(78, 72)));
  CHECK(views.pixel(90, 72).a == 0);
}

TEST_CASE("an svg draws an element through its filter") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement filter{.kind = SvgKind::Filter, .name = "f"};
  filter.units = 1;
  filter.contentUnits = 1;
  filter.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(12)}, {"dy", len(0)}};
  auto moved = rect(0, 0, 12, 24, 0xffff0000);
  moved.filter = "f";
  mountSvg(views, node(icon(), {node(filter, {node(offset)}), node(moved)}));
  // Moved right by half the view.
  CHECK(views.pixel(24, 48).a == 0);
  CHECK(reddish(views.pixel(72, 48)));
}

TEST_CASE("an svg draws its new document, and its elements' own views are hidden") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountSvg(views, node(icon(), {node(rect(0, 0, 24, 24, 0xffff0000))}));
  CHECK(reddish(views.pixel(48, 48)));
  views.add(MountedViews::shadow(3, "RNSVGRect", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}}), 2);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(3)));
  views.backend->setSvgDrawing(MountedViews::kSurface, 2, std::make_shared<const ngn::SvgDocument>(ngn::SvgDocument{.root = node(icon(), {node(rect(0, 0, 24, 24, 0xff0000ff))})}));
  views.settle();
  CHECK(bluish(views.pixel(48, 48)));
}

TEST_CASE("the cairo canvas measures text as Pango lays it out, and splits it into clusters in the order of the text") {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  auto canvas = ngn::gtk::makeCairoCanvas(cr, 10, 10, 1);
  double one = canvas->measureText("W", 20, "", "");
  double three = canvas->measureText("WWW", 20, "", "");
  CHECK(one > 5);
  CHECK(three == doctest::Approx(one * 3).epsilon(0.05));
  auto clusters = canvas->glyphClusters("abc", 20, "", "");
  REQUIRE(clusters.size() == 3);
  CHECK(clusters[0].text == "a");
  CHECK(clusters[2].text == "c");
  CHECK(clusters[0].x == doctest::Approx(0));
  CHECK(clusters[1].x == doctest::Approx(clusters[0].advance));
  CHECK(clusters[2].x + clusters[2].advance == doctest::Approx(canvas->measureText("abc", 20, "", "")).epsilon(0.01));
  canvas.reset();
  cairo_destroy(cr);
  cairo_surface_destroy(surface);
}

TEST_CASE("a pattern's tiles start at its x and y and follow its patternTransform") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  // 6 by 12 tiles, green on their left half, moved right by half a tile.
  SvgElement moved{.kind = SvgKind::Pattern, .name = "moved"};
  moved.units = 1;
  moved.lengths = {{"x", len(3)}, {"y", len(0)}, {"width", len(6)}, {"height", len(12)}};
  // The same tiles at the origin, twice as wide through the transform.
  SvgElement wide{.kind = SvgKind::Pattern, .name = "wide"};
  wide.units = 1;
  wide.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(6)}, {"height", len(12)}};
  wide.gradientTransform = ngn::SvgMatrix::scale(2, 1);
  auto top = rect(0, 0, 24, 12);
  top.fill = {.type = SvgBrush::Type::Ref, .ref = "moved"};
  top.propList = {"fill"};
  auto bottom = rect(0, 12, 24, 12);
  bottom.fill = {.type = SvgBrush::Type::Ref, .ref = "wide"};
  bottom.propList = {"fill"};
  mountSvg(views, node(icon(), {node(moved, {node(rect(0, 0, 3, 12, 0xff00ff00))}), node(wide, {node(rect(0, 0, 3, 12, 0xff00ff00))}), node(top), node(bottom)}));
  // Green from 12 to 24 points of each 24, not from 0.
  CHECK(views.pixel(6, 24).a == 0);
  CHECK(greenish(views.pixel(18, 24)));
  CHECK(views.pixel(30, 24).a == 0);
  CHECK(greenish(views.pixel(42, 24)));
  // Green for the first 24 points of each 48.
  CHECK(greenish(views.pixel(6, 72)));
  CHECK(greenish(views.pixel(18, 72)));
  CHECK(views.pixel(30, 72).a == 0);
  CHECK(greenish(views.pixel(54, 72)));
}

TEST_CASE("an svg <image> whose load failed, or whose picture cairo cannot hold, is not requested again on each draw") {
  REQUIRE(ngn::testing::gtkReady());
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::gtk::useImageLoading(http, nullptr);
  struct Restore {
    ~Restore() {
      ngn::gtk::useImageLoading(nullptr, nullptr);
    }
  } restore;

  auto ended = std::make_shared<int>(0);
  drawImage("https://example.com/offline.png", ended);
  answer(*http, "");
  ngn::testing::runUntil([ended] { return *ended == 1; });
  drawImage("https://example.com/offline.png");
  CHECK(http->sent.size() == 1);

  // Wider than a cairo image surface can be (32767 pixels): decoded, but never drawn.
  std::vector<guchar> pixels(40000 * 4, 0xff);
  GBytes *data = g_bytes_new(pixels.data(), pixels.size());
  GdkTexture *texture = gdk_memory_texture_new(40000, 1, GDK_MEMORY_DEFAULT, data, 40000 * 4);
  g_bytes_unref(data);
  GBytes *png = gdk_texture_save_to_png_bytes(texture);
  g_object_unref(texture);
  // Copied into no pixels: GDK's check on the pointer is all that stops a write through null.
  int criticals = 0;
  // Removed on every exit path: runUntil throws on a timeout, and the handler holds &criticals.
  struct Handler {
    guint id;
    ~Handler() {
      g_log_remove_handler("Gdk", id);
    }
  } handler{g_log_set_handler("Gdk", G_LOG_LEVEL_CRITICAL, [](const gchar *, GLogLevelFlags, const gchar *, gpointer count) {
    ++*static_cast<int *>(count);
  }, &criticals)};
  drawImage("https://example.com/huge.png", ended);
  answer(*http, std::string(static_cast<const char *>(g_bytes_get_data(png, nullptr)), g_bytes_get_size(png)));
  g_bytes_unref(png);
  // Decoded off the main thread: only the load's end says cairo has been given it.
  ngn::testing::runUntil([ended] { return *ended == 2; });
  drawImage("https://example.com/huge.png");
  CHECK(criticals == 0);
  CHECK(http->sent.size() == 2);
}

TEST_CASE("an svg element's view stays hidden when it is removed and inserted again, or moved") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountSvg(views, node(icon(), {node(rect(0, 0, 24, 24, 0xffff0000))}));
  auto element = MountedViews::shadow(3, "RNSVGRect", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}});
  auto other = MountedViews::shadow(4, "RNSVGGroup", desktopViewProps(dynamic::object()), {{0, 0}, {96, 96}});
  views.add(element, 2);
  views.add(other, 2);
  REQUIRE_FALSE(gtk_widget_get_child_visible(views.view(3)));
  views.mount({ShadowViewMutation::RemoveMutation(2, element, 0), ShadowViewMutation::InsertMutation(2, element, 1)});
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(3)));
  // Moved while it has a parent: insertChild takes it out itself.
  views.backend->insertChild(MountedViews::kSurface, 2, 3, 0);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(3)));
  // The svg itself still draws.
  CHECK(gtk_widget_get_child_visible(views.view(2)));
}

TEST_CASE("an svg draws what follows a group whose transform cannot be inverted") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement flat{.kind = SvgKind::Group};
  flat.matrix = ngn::SvgMatrix::scale(0, 0);
  mountSvg(views, node(icon(), {node(flat, {node(rect(0, 0, 24, 24, 0xff0000ff))}), node(rect(0, 0, 24, 24, 0xffff0000))}));
  CHECK(reddish(views.pixel(48, 48)));
}

TEST_CASE("an svg's filter moves into the view what is drawn outside it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement filter{.kind = SvgKind::Filter, .name = "f"};
  filter.units = 1;
  filter.contentUnits = 1;
  filter.lengths = {{"x", len(-12)}, {"y", len(0)}, {"width", len(36)}, {"height", len(24)}};
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(24)}, {"dy", len(0)}};
  // Left of the view, moved to its right half.
  auto moved = rect(-12, 0, 12, 24, 0xffff0000);
  moved.filter = "f";
  mountSvg(views, node(icon(), {node(filter, {node(offset)}), node(moved)}));
  CHECK(views.pixel(24, 48).a == 0);
  CHECK(reddish(views.pixel(72, 48)));
}

TEST_CASE("the cairo canvas lays out a line break in a run as a space") {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  auto canvas = ngn::gtk::makeCairoCanvas(cr, 10, 10, 1);
  double spaced = canvas->measureText("ab cd", 20, "", "");
  CHECK(canvas->measureText("ab\ncd", 20, "", "") == doctest::Approx(spaced));
  CHECK(canvas->measureText("ab\rcd", 20, "", "") == doctest::Approx(spaced));
  auto clusters = canvas->glyphClusters("ab\ncd", 20, "", "");
  REQUIRE(clusters.size() == 5);
  CHECK(clusters[4].text == "d");
  CHECK(clusters[4].x + clusters[4].advance == doctest::Approx(spaced).epsilon(0.01));
  canvas.reset();
  cairo_destroy(cr);
  cairo_surface_destroy(surface);
}

TEST_CASE("an svg that draws more images than the cache keeps loads each of them once") {
  REQUIRE(ngn::testing::gtkReady());
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::gtk::useImageLoading(http, nullptr);
  struct Restore {
    ~Restore() {
      ngn::gtk::useImageLoading(nullptr, nullptr);
    }
  } restore;
  std::optional<MountedViews> views;
  views.emplace();
  // One past the cache's 64, in cells of 10 points, 9 to a row.
  constexpr int kImages = 65;
  auto uri = [](int i) { return "https://example.com/many-" + std::to_string(i) + ".png"; };
  auto root = icon();
  root.vbWidth = root.vbHeight = 96;
  std::vector<SvgNode> images;
  for (int i = 0; i < kImages; ++i) {
    SvgElement image{.kind = SvgKind::Image, .uri = uri(i)};
    image.align = "xMidYMid";
    image.lengths = {{"x", len(i % 9 * 10)}, {"y", len(i / 9 * 10)}, {"width", len(10)}, {"height", len(10)}};
    images.push_back(node(image));
  }
  mountSvg(*views, node(root, std::move(images)));
  REQUIRE(http->sent.size() == kImages);
  // A canvas beside the view's, told as each load ends.
  auto ended = std::make_shared<int>(0);
  for (int i = 0; i < kImages; ++i) {
    drawImage(uri(i), ended);
  }
  std::string red = pngOf(1, 1, 0xffff0000);
  for (int i = 0; i < kImages; ++i) {
    answer(*http, red, i);
  }
  ngn::testing::runUntil([ended] { return *ended == kImages; });
  views->settle();
  views->settle();
  CHECK(http->sent.size() == kImages);
  CHECK(reddish(views->pixel(5, 5)));
  CHECK(reddish(views->pixel(15, 75)));
  CHECK(ngn::gtk::svgImagesKept() == kImages);

  // Gone, the view holds them no more: the cache is back to 64 at once.
  views.reset();
  CHECK(ngn::gtk::svgImagesKept() == 64);
}

TEST_CASE("each svg view is told once when an image it draws while it loads has loaded") {
  REQUIRE(ngn::testing::gtkReady());
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::gtk::useImageLoading(http, nullptr);
  struct Restore {
    ~Restore() {
      ngn::gtk::useImageLoading(nullptr, nullptr);
    }
  } restore;
  const std::string uri = "https://example.com/told-once.png";
  ngn::gtk::SvgImageHold one, two;
  auto toldOne = std::make_shared<int>(0), toldTwo = std::make_shared<int>(0), toldGone = std::make_shared<int>(0);
  for (int i = 0; i < 3; ++i) {
    drawImage(uri, toldOne, &one);
  }
  drawImage(uri, toldTwo, &two);
  {
    // A view that goes while the image loads is not told.
    ngn::gtk::SvgImageHold gone;
    drawImage(uri, toldGone, &gone);
  }
  REQUIRE(http->sent.size() == 1);
  answer(*http, pngOf(1, 1, 0xffff0000));
  ngn::testing::runUntil([toldTwo] { return *toldTwo == 1; });
  CHECK(*toldOne == 1);
  CHECK(*toldGone == 0);
}

TEST_CASE("an svg draws a masked element in a pattern's tile of less than a pixel") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  SvgElement mask{.kind = SvgKind::Mask, .name = "m"};
  mask.units = 1;
  mask.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(24)}, {"height", len(24)}};
  // Tiles of 0.1 units, 0.4 pixels, each filled with red through a mask that shows all of it.
  SvgElement pattern{.kind = SvgKind::Pattern, .name = "p"};
  pattern.units = 1;
  pattern.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(0.1)}, {"height", len(0.1)}};
  auto masked = rect(0, 0, 0.1, 0.1, 0xffff0000);
  masked.mask = "m";
  auto tiled = rect(0, 0, 24, 24);
  tiled.fill = {.type = SvgBrush::Type::Ref, .ref = "p"};
  tiled.propList = {"fill"};
  mountSvg(views, node(icon(), {node(mask, {node(rect(0, 0, 24, 24, 0xffffffff))}), node(pattern, {node(masked)}), node(tiled)}));
  CHECK(reddish(views.pixel(48, 48)));
}

TEST_CASE("an svg draws what follows a filter region wider than cairo's bitmaps") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  // 10000 units of 4 pixels: 40000 pixels wide, past cairo's 32767, in few pixels all told.
  SvgElement filter{.kind = SvgKind::Filter, .name = "f"};
  filter.units = 1;
  filter.contentUnits = 1;
  filter.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(10000)}, {"height", len(1)}};
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(0)}, {"dy", len(0)}};
  auto filtered = rect(0, 0, 24, 1, 0xff0000ff);
  filtered.filter = "f";
  mountSvg(views, node(icon(), {node(filter, {node(offset)}), node(filtered), node(rect(0, 12, 24, 12, 0xffff0000))}));
  CHECK(bluish(views.pixel(48, 2)));
  CHECK(reddish(views.pixel(48, 72)));
}

TEST_CASE("the cairo canvas draws a filter's source unfiltered when its bitmap cannot be made") {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  // A view wider than cairo's bitmaps, so even the view's pixels do not fit.
  auto canvas = ngn::gtk::makeCairoCanvas(cr, 40000, 10, 1);
  ngn::SvgPath square;
  square.moveTo(0, 0);
  square.lineTo(10, 0);
  square.lineTo(10, 10);
  square.lineTo(0, 10);
  square.close();
  canvas->beginFilter({.region = {0, 0, 40000, 10}});
  canvas->fill(square, false, {.argb = 0xffff0000});
  canvas->endFilter();
  canvas.reset();
  cairo_destroy(cr);
  cairo_surface_flush(surface);
  // Premultiplied ARGB: the corner pixel is red.
  CHECK(*reinterpret_cast<const uint32_t *>(cairo_image_surface_get_data(surface)) == 0xffff0000);
  cairo_surface_destroy(surface);
}

TEST_CASE("the cairo canvas draws what follows a mask whose bitmap cannot be made") {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, 10, 10);
  cairo_t *cr = cairo_create(surface);
  // A view wider than cairo's bitmaps, so even the view's pixels do not fit.
  auto canvas = ngn::gtk::makeCairoCanvas(cr, 40000, 10, 1);
  ngn::SvgPath square;
  square.moveTo(0, 0);
  square.lineTo(10, 0);
  square.lineTo(10, 10);
  square.lineTo(0, 10);
  square.close();
  ngn::SvgPath corner;
  corner.moveTo(5, 5);
  corner.lineTo(10, 5);
  corner.lineTo(10, 10);
  corner.lineTo(5, 10);
  corner.close();
  canvas->beginMask(false);
  // The mask's own drawing must reach no pixel.
  canvas->fill(square, false, {.argb = 0xffffffff});
  canvas->endMask();
  canvas->endMasked();
  // Drawn after the mask: lost when the mask's error surface reaches the parent context.
  canvas->fill(corner, false, {.argb = 0xff00ff00});
  canvas.reset();
  cairo_destroy(cr);
  cairo_surface_flush(surface);
  const auto *pixels = reinterpret_cast<const uint32_t *>(cairo_image_surface_get_data(surface));
  CHECK(pixels[7 * 10 + 7] == 0xff00ff00);
  // Only the mask's own shape covers this one: it stays transparent.
  CHECK(pixels[1 * 10 + 1] == 0);
  cairo_surface_destroy(surface);
}

TEST_CASE("an SVG icon as a tray's pixmaps: each size in its colour, unpremultiplied, alpha first in network order") {
  constexpr const char *topHalf = R"svg(<svg viewBox="0 0 16 16"><rect width="16" height="8"/></svg>)svg";
  GVariant *pixmaps = ngn::gtk::svgIconPixmaps(topHalf, 0x80336699, {16, 32});
  g_variant_ref_sink(pixmaps);
  REQUIRE(g_variant_n_children(pixmaps) == 2);
  for (gsize i = 0; i < 2; i++) {
    gint32 width = 0, height = 0;
    GVariant *bytes = nullptr;
    g_variant_get_child(pixmaps, i, "(ii@ay)", &width, &height, &bytes);
    CHECK(width == (i == 0 ? 16 : 32));
    CHECK(height == width);
    gsize size = 0;
    const auto *data = static_cast<const guchar *>(g_variant_get_fixed_array(bytes, &size, 1));
    REQUIRE(size == static_cast<gsize>(width * height * 4));
    // A pixel in the top half, then one in the bottom half.
    const guchar *top = data + (static_cast<size_t>(2 * width / 16) * width + width / 2) * 4;
    CHECK(top[0] == 0x80);
    CHECK(std::abs(top[1] - 0x33) <= 1);
    CHECK(std::abs(top[2] - 0x66) <= 1);
    CHECK(std::abs(top[3] - 0x99) <= 1);
    const guchar *bottom = data + (static_cast<size_t>(13 * width / 16) * width + width / 2) * 4;
    CHECK(bottom[0] == 0);
    g_variant_unref(bytes);
  }
  g_variant_unref(pixmaps);

  // Markup that is no svg has none.
  GVariant *none = g_variant_ref_sink(ngn::gtk::svgIconPixmaps("lucideTimer", 0xffffffff));
  CHECK(g_variant_n_children(none) == 0);
  g_variant_unref(none);

  // As a PNG, for a tray menu's item.
  std::string png = ngn::gtk::svgIconPng(topHalf, 32, 0xffffffff);
  REQUIRE(png.size() > 8);
  CHECK(png.substr(1, 3) == "PNG");
  CHECK(ngn::gtk::svgIconPng("lucideTimer", 32, 0xffffffff).empty());

  // A size past what cairo can make is left out, rather than read from a surface with no pixels.
  GVariant *past = g_variant_ref_sink(ngn::gtk::svgIconPixmaps(topHalf, 0xffffffff, {16, 40000}));
  CHECK(g_variant_n_children(past) == 1);
  g_variant_unref(past);
  CHECK(ngn::gtk::svgIconPng(topHalf, 40000, 0xffffffff).empty());
}
