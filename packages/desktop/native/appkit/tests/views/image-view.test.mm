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

struct Rgba {
  int r, g, b, a;
};

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

void waitForImage(NSView *view) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (view.layer.sublayers.firstObject.contents == nil && deadline.timeIntervalSinceNow > 0) {
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
