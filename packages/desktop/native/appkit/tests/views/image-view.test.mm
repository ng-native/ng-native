// An Image (image-view.mm) keeps its picture through the view's own redraws: every layout asks
// NGNView to draw its box again, which replaces its layer's contents.
#import "../../image-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>
#include <react/renderer/components/image/ImageComponentDescriptor.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;

namespace {

// A 2 by 2 opaque red PNG.
constexpr const char *kRedPixels =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";

// The picture on the view's layers, or nil.
id drawnImage(NSView *view) {
  if (view.layer.contents != nil && [view.layer.contents isKindOfClass:NSImage.class]) {
    return view.layer.contents;
  }
  for (CALayer *layer in view.layer.sublayers) {
    if ([layer.contents isKindOfClass:NSImage.class]) {
      return layer.contents;
    }
  }
  return nil;
}

} // namespace

TEST_CASE("An image keeps its picture when the view lays out and redraws after it loads") {
  MountedViews mounted;
  auto props = parsedProps<ImageComponentDescriptor>(
      folly::dynamic::object("source", folly::dynamic::array(folly::dynamic::object("uri", kRedPixels))));
  auto image = MountedViews::shadow(5, "Image", props);
  mounted.add(image);
  NSView *view = mounted.view(5);
  REQUIRE((view != nil));
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (drawnImage(view) == nil && deadline.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  REQUIRE((drawnImage(view) != nil));

  // A layout after the load, and the redraw it asks for.
  auto moved = image;
  moved.layoutMetrics.frame.origin.y = 40;
  mounted.mount({ShadowViewMutation::UpdateMutation(image, moved, MountedViews::kSurface)});
  [view displayIfNeeded];
  CHECK((drawnImage(view) != nil));
}

namespace {

struct Rgb {
  int r, g, b;
};

struct Rgba {
  int r, g, b, a;
};

// A 2 by 2 PNG as a data uri: red and green on its top row, blue and white under them.
std::string quadrantsUri() {
  // Core Graphics' bitmap rows run top down in memory.
  const uint8_t pixels[] = {255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, 2, 2, 8, 8, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  std::memcpy(CGBitmapContextGetData(context), pixels, sizeof(pixels));
  CGImageRef image = CGBitmapContextCreateImage(context);
  NSData *png = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  CGImageRelease(image);
  CGContextRelease(context);
  return std::string("data:image/png;base64,") + [png base64EncodedStringWithOptions:0].UTF8String;
}

// A 2 by 1 PNG as a data uri: an opaque red pixel and a transparent one.
std::string redAndClearUri() {
  const uint8_t pixels[] = {255, 0, 0, 255, 0, 0, 0, 0};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, 2, 1, 8, 8, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  std::memcpy(CGBitmapContextGetData(context), pixels, sizeof(pixels));
  CGImageRef image = CGBitmapContextCreateImage(context);
  NSData *png = [[[NSBitmapImageRep alloc] initWithCGImage:image] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  CGImageRelease(image);
  CGContextRelease(context);
  return std::string("data:image/png;base64,") + [png base64EncodedStringWithOptions:0].UTF8String;
}

// The view's layers drawn at one pixel to the point, as they show on screen: row 0 is the top.
std::vector<uint8_t> drawnPixels(NSView *view, int width, int height) {
  std::vector<uint8_t> data(static_cast<size_t>(width) * height * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  [view.layer renderInContext:context];
  CGContextRelease(context);
  return data;
}

// A pixel, un-premultiplied.
Rgba pixel(const std::vector<uint8_t> &data, int width, int x, int y) {
  const uint8_t *p = &data[(static_cast<size_t>(y) * width + x) * 4];
  if (p[3] == 0) {
    return {0, 0, 0, 0};
  }
  return {p[0] * 255 / p[3], p[1] * 255 / p[3], p[2] * 255 / p[3], p[3]};
}

bool near(Rgba a, Rgba b) {
  return std::abs(a.r - b.r) < 8 && std::abs(a.g - b.g) < 8 && std::abs(a.b - b.b) < 8 && std::abs(a.a - b.a) < 8;
}

Rgb at(const std::vector<uint8_t> &data, int width, int x, int y) {
  const uint8_t *p = &data[(static_cast<size_t>(y) * width + x) * 4];
  return {p[0], p[1], p[2]};
}

bool is(Rgb a, Rgb b) {
  return std::abs(a.r - b.r) < 8 && std::abs(a.g - b.g) < 8 && std::abs(a.b - b.b) < 8;
}

// Runs the main loop until the image's layer shows a picture, as contents or as a tiled background.
void waitForImage(NSView *view) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (view.layer.sublayers.firstObject.contents == nil && view.layer.sublayers.firstObject.backgroundColor == nil &&
         deadline.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
}

folly::dynamic tintedProps(const std::string &uri, std::optional<int64_t> tint) {
  auto raw = folly::dynamic::object("resizeMode", "stretch")("source", folly::dynamic::array(folly::dynamic::object("uri", uri)));
  if (tint) {
    raw("tintColor", *tint);
  }
  return raw;
}

} // namespace

TEST_CASE("An image with a tintColor shows its shape in the tint, and takes a changed or removed tint") {
  MountedViews mounted;
  auto uri = redAndClearUri();
  auto image = MountedViews::shadow(5, "Image", parsedProps<ImageComponentDescriptor>(tintedProps(uri, 0xff0000ff)));
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  // Stretched over 200 by 24: the opaque pixel is the left half, the transparent one the right.
  auto blue = drawnPixels(view, 200, 24);
  CHECK(near(pixel(blue, 200, 50, 10), {0, 0, 255, 255}));
  CHECK(near(pixel(blue, 200, 150, 10), {0, 0, 0, 0}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(tintedProps(uri, 0xff00ff00)));
  [view displayIfNeeded];
  auto green = drawnPixels(view, 200, 24);
  CHECK(near(pixel(green, 200, 50, 10), {0, 255, 0, 255}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(tintedProps(uri, std::nullopt)));
  [view displayIfNeeded];
  auto plain = drawnPixels(view, 200, 24);
  CHECK(near(pixel(plain, 200, 50, 10), {255, 0, 0, 255}));
}

TEST_CASE("An image with a transparent tintColor draws nothing, and shows its picture again when the tint goes") {
  MountedViews mounted;
  auto uri = redAndClearUri();
  // 0 is transparent black, the one colour React Native's SharedColor converts to false.
  auto image = MountedViews::shadow(5, "Image", parsedProps<ImageComponentDescriptor>(tintedProps(uri, 0)));
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  auto clear = drawnPixels(view, 200, 24);
  CHECK(near(pixel(clear, 200, 50, 10), {0, 0, 0, 0}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(tintedProps(uri, 0xff0000ff)));
  [view displayIfNeeded];
  auto blue = drawnPixels(view, 200, 24);
  CHECK(near(pixel(blue, 200, 50, 10), {0, 0, 255, 255}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(tintedProps(uri, 0)));
  [view displayIfNeeded];
  auto cleared = drawnPixels(view, 200, 24);
  CHECK(near(pixel(cleared, 200, 50, 10), {0, 0, 0, 0}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(tintedProps(uri, std::nullopt)));
  [view displayIfNeeded];
  auto plain = drawnPixels(view, 200, 24);
  CHECK(near(pixel(plain, 200, 50, 10), {255, 0, 0, 255}));
}

TEST_CASE("An image with resizeMode repeat tiles at its own size from its top left") {
  MountedViews mounted;
  auto props = parsedProps<ImageComponentDescriptor>(folly::dynamic::object("resizeMode", "repeat")(
      "source", folly::dynamic::array(folly::dynamic::object("uri", quadrantsUri()))));
  auto image = MountedViews::shadow(5, "Image", props);
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  auto data = drawnPixels(view, 200, 24);
  CHECK(is(at(data, 200, 0, 0), {255, 0, 0}));
  CHECK(is(at(data, 200, 1, 0), {0, 255, 0}));
  CHECK(is(at(data, 200, 0, 1), {0, 0, 255}));
  CHECK(is(at(data, 200, 1, 1), {255, 255, 255}));
  // The next tiles, across and down, and the last pixel of the view.
  CHECK(is(at(data, 200, 2, 0), {255, 0, 0}));
  CHECK(is(at(data, 200, 3, 0), {0, 255, 0}));
  CHECK(is(at(data, 200, 0, 2), {255, 0, 0}));
  CHECK(is(at(data, 200, 199, 23), {255, 255, 255}));
}

TEST_CASE("An image goes from stretching to repeat and back") {
  MountedViews mounted;
  auto source = folly::dynamic::array(folly::dynamic::object("uri", quadrantsUri()));
  auto image = MountedViews::shadow(5, "Image", parsedProps<ImageComponentDescriptor>(folly::dynamic::object("source", source)));
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  // Stretched over 200 by 24: the top left quadrant is red, and the lower right white.
  auto stretched = drawnPixels(view, 200, 24);
  CHECK(is(at(stretched, 200, 1, 0), {255, 0, 0}));
  CHECK(is(at(stretched, 200, 150, 20), {255, 255, 255}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(folly::dynamic::object("resizeMode", "repeat")("source", source)));
  [view displayIfNeeded];
  auto tiled = drawnPixels(view, 200, 24);
  CHECK(is(at(tiled, 200, 1, 0), {0, 255, 0}));

  mounted.update(image, parsedProps<ImageComponentDescriptor>(folly::dynamic::object("source", source)));
  [view displayIfNeeded];
  auto again = drawnPixels(view, 200, 24);
  CHECK(is(at(again, 200, 1, 0), {255, 0, 0}));
}

TEST_CASE("An image with resizeMode repeat tiles a picture whose source has a scale at its size in points") {
  MountedViews mounted;
  // 2 pixels at a scale of 2 are one point: the tile repeats every point, so pixels one point apart
  // show the same colour (the four quadrants averaged), where an unscaled tile shows red then green.
  auto props = parsedProps<ImageComponentDescriptor>(folly::dynamic::object("resizeMode", "repeat")(
      "source", folly::dynamic::array(folly::dynamic::object("uri", quadrantsUri())("scale", 2))));
  auto image = MountedViews::shadow(5, "Image", props);
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  auto data = drawnPixels(view, 200, 24);
  Rgb origin = at(data, 200, 0, 0);
  CHECK(!is(origin, {255, 0, 0}));
  CHECK(is(at(data, 200, 1, 0), origin));
  CHECK(is(at(data, 200, 0, 1), origin));
  CHECK(is(at(data, 200, 7, 5), origin));
}

TEST_CASE("An image with resizeMode repeat and a tintColor tiles the tinted picture") {
  MountedViews mounted;
  auto props = parsedProps<ImageComponentDescriptor>(folly::dynamic::object("resizeMode", "repeat")("tintColor", 0xff0000ff)(
      "source", folly::dynamic::array(folly::dynamic::object("uri", redAndClearUri()))));
  auto image = MountedViews::shadow(5, "Image", props);
  mounted.add(image);
  NSView *view = mounted.view(5);
  waitForImage(view);
  [view displayIfNeeded];
  // The picture is an opaque pixel then a clear one, so the tinted tiles alternate blue and clear.
  auto data = drawnPixels(view, 200, 24);
  CHECK(near(pixel(data, 200, 0, 0), {0, 0, 255, 255}));
  CHECK(near(pixel(data, 200, 1, 0), {0, 0, 0, 0}));
  CHECK(near(pixel(data, 200, 2, 0), {0, 0, 255, 255}));
  CHECK(near(pixel(data, 200, 100, 20), {0, 0, 255, 255}));
}
