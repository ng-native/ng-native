// Markers, patterns, filters and foreignObjects drawn by the Core Graphics canvas (cg-canvas.mm)
// into bitmaps.
#include "../cg-canvas.h"

#import <QuartzCore/QuartzCore.h>

#include <doctest/doctest.h>

#include <array>
#include <cmath>

using ngn::SvgBrush;
using ngn::SvgElement;
using ngn::SvgKind;
using ngn::SvgLength;
using ngn::SvgNode;

namespace {

SvgLength len(double v) {
  return {.value = v, .set = true};
}
SvgBrush color(uint32_t argb) {
  return {.type = SvgBrush::Type::Color, .argb = argb};
}
SvgNode node(SvgElement element, std::vector<SvgNode> children = {}) {
  return {.element = std::move(element), .children = std::move(children)};
}
SvgElement rect(double x, double y, double w, double h, uint32_t argb) {
  SvgElement e{.kind = SvgKind::Rect};
  e.lengths = {{"x", len(x)}, {"y", len(y)}, {"width", len(w)}, {"height", len(h)}};
  e.fill = color(argb);
  return e;
}
SvgElement named(SvgKind kind, std::string name) {
  SvgElement e{.kind = kind};
  e.name = std::move(name);
  return e;
}

// A view's worth of pixels, drawn as the svg view draws: top left, y down, `scale` pixels a point.
struct Bitmap {
  int width, height;
  double scale;
  std::vector<uint8_t> data;

  Bitmap(SvgNode root, int w, int h, double s = 1) : width(w), height(h), scale(s) {
    size_t pw = static_cast<size_t>(w * s), ph = static_cast<size_t>(h * s);
    data.assign(pw * ph * 4, 0);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(data.data(), pw, ph, 8, pw * 4, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    CGContextTranslateCTM(context, 0, ph);
    CGContextScaleCTM(context, s, -s);
    auto canvas = NGNMakeCGCanvas(context, CGSizeMake(w, h), s, nil);
    ngn::drawSvg({.root = std::move(root)}, w, h, *canvas);
    canvas.reset();
    CGContextRelease(context);
  }

  // The pixel under a point, as RGBA.
  std::array<int, 4> at(double x, double y) const {
    size_t px = static_cast<size_t>(x * scale), py = static_cast<size_t>(y * scale);
    const uint8_t *p = &data[(py * static_cast<size_t>(width * scale) + px) * 4];
    return {p[0], p[1], p[2], p[3]};
  }
};

std::string show(const std::array<int, 4> &p) {
  return std::to_string(p[0]) + "," + std::to_string(p[1]) + "," + std::to_string(p[2]) + "," + std::to_string(p[3]);
}

SvgNode shadowFilter() {
  SvgElement f = named(SvgKind::Filter, "shadow");
  f.units = 1;
  f.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(60)}, {"height", len(60)}};
  SvgElement blur{.kind = SvgKind::FeGaussianBlur};
  blur.in1 = "SourceAlpha";
  blur.stdDeviationX = 1;
  blur.stdDeviationY = 1;
  SvgElement offset{.kind = SvgKind::FeOffset};
  offset.lengths = {{"dx", len(6)}, {"dy", len(6)}};
  offset.result = "moved";
  SvgElement flood{.kind = SvgKind::FeFlood};
  flood.flood = color(0xff000000);
  flood.floodOpacity = 0.5;
  SvgElement composite{.kind = SvgKind::FeComposite};
  composite.in2 = "moved";
  composite.op = 1;
  SvgElement merge{.kind = SvgKind::FeMerge};
  merge.nodes = {"", "SourceGraphic"};
  return node(f, {node(blur), node(offset), node(flood), node(composite), node(merge)});
}

} // namespace

TEST_CASE("a drop shadow: the shape in place, a soft half-black copy below and right of it, nothing elsewhere") {
  for (double scale : {1.0, 2.0}) {
    SvgElement shape = rect(10, 10, 20, 20, 0xffff0000);
    shape.filter = "shadow";
    Bitmap bitmap(node({.kind = SvgKind::Svg}, {shadowFilter(), node(shape)}), 50, 50, scale);
    INFO("scale " << scale);
    CHECK(show(bitmap.at(20, 20)) == "255,0,0,255");
    // The shadow alone, past the shape's corner.
    auto shadow = bitmap.at(33, 33);
    INFO(show(shadow));
    CHECK(shadow[0] == 0);
    CHECK(shadow[3] == doctest::Approx(128).epsilon(0.1));
    // Its edge is blurred: part way in, part way out.
    auto edge = bitmap.at(36, 33);
    CHECK(edge[3] > 0);
    CHECK(edge[3] < shadow[3]);
    CHECK(bitmap.at(5, 45)[3] == 0);
    CHECK(bitmap.at(12, 33)[3] == 0);
  }
}

TEST_CASE("a colour matrix draws its element grey") {
  SvgElement f = named(SvgKind::Filter, "grey");
  SvgElement matrix{.kind = SvgKind::FeColorMatrix};
  matrix.op = 1;
  matrix.values = {0};
  SvgElement shape = rect(0, 0, 10, 10, 0xffff0000);
  shape.filter = "grey";
  Bitmap bitmap(node({.kind = SvgKind::Svg}, {node(f, {node(matrix)}), node(shape)}), 20, 20);
  auto p = bitmap.at(5, 5);
  INFO(show(p));
  CHECK(p[0] == p[1]);
  CHECK(p[1] == p[2]);
  CHECK(p[0] == doctest::Approx(54).epsilon(0.15));
  CHECK(p[3] == 255);
}

TEST_CASE("a pattern tiles its content upright across the shape, from the tile's origin") {
  for (double scale : {1.0, 2.0}) {
    SvgElement p = named(SvgKind::Pattern, "quarters");
    p.units = 1;
    p.lengths = {{"x", len(0)}, {"y", len(0)}, {"width", len(10)}, {"height", len(10)}};
    SvgElement shape = rect(0, 0, 40, 30, 0);
    shape.fill = {.type = SvgBrush::Type::Ref, .ref = "quarters"};
    // Blue in each tile's top left quarter.
    Bitmap bitmap(
        node({.kind = SvgKind::Svg}, {node(p, {node(rect(0, 0, 5, 5, 0xff0000ff))}), node(shape)}), 50, 50, scale);
    INFO("scale " << scale);
    CHECK(show(bitmap.at(2, 2)) == "0,0,255,255");
    CHECK(show(bitmap.at(12, 22)) == "0,0,255,255");
    CHECK(show(bitmap.at(32, 12)) == "0,0,255,255");
    CHECK(bitmap.at(2, 7)[3] == 0);
    CHECK(bitmap.at(7, 2)[3] == 0);
    CHECK(bitmap.at(17, 17)[3] == 0);
    // Only inside the shape.
    CHECK(bitmap.at(42, 2)[3] == 0);
    CHECK(bitmap.at(2, 32)[3] == 0);
  }
}

TEST_CASE("a marker draws its content at the line's end, turned along it") {
  SvgElement m = named(SvgKind::Marker, "tip");
  m.markerUnits = "userSpaceOnUse";
  m.orient = "auto";
  m.lengths = {{"markerWidth", len(10)}, {"markerHeight", len(10)}, {"refX", len(0)}, {"refY", len(5)}};
  // A bar along the marker's x axis, above its ref line only.
  SvgElement bar = rect(0, 0, 8, 5, 0xff00ff00);
  SvgElement line{.kind = SvgKind::Path};
  line.d = "M20,5 L20,30";
  line.fill = {.type = SvgBrush::Type::None};
  line.markerEnd = "tip";
  Bitmap bitmap(node({.kind = SvgKind::Svg}, {node(m, {node(bar)}), node(line)}), 40, 50);
  // The line runs down, so the marker's x runs down from (20, 30) and its "above" is to the right.
  CHECK(show(bitmap.at(22, 34)) == "0,255,0,255");
  CHECK(bitmap.at(18, 34)[3] == 0);
  CHECK(bitmap.at(22, 26)[3] == 0);
  CHECK(bitmap.at(22, 39)[3] == 0);
}

TEST_CASE("an alpha mask lets its content's alpha through, so black content shows what it masks") {
  for (int type : {1, 0}) {
    SvgElement mask = named(SvgKind::Mask, "m");
    mask.maskType = type;
    SvgElement shape = rect(0, 0, 20, 20, 0xffff0000);
    shape.mask = "m";
    Bitmap bitmap(node({.kind = SvgKind::Svg}, {node(mask, {node(rect(0, 0, 10, 20, 0xff000000))}), node(shape)}), 20, 20);
    auto inside = bitmap.at(5, 5), outside = bitmap.at(15, 5);
    INFO("maskType ", type, ": ", show(inside), " / ", show(outside));
    // Alpha: opaque black shows the shape. Luminance: black hides it.
    CHECK(inside[3] == (type == 1 ? 255 : 0));
    CHECK(outside[3] == 0);
  }
}

TEST_CASE("a filter or mask whose bitmap cannot be made draws its content unfiltered, or unmasked") {
  // A canvas that says it is far larger than any bitmap can be, over a small context.
  std::vector<uint8_t> data(20 * 20 * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), 20, 20, 8, 80, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, 20);
  CGContextScaleCTM(context, 1, -1);
  const double huge = 1e9;
  for (bool masked : {false, true}) {
    std::fill(data.begin(), data.end(), 0);
    SvgElement effect = masked ? named(SvgKind::Mask, "e") : named(SvgKind::Filter, "e");
    SvgElement shape = rect(0, 0, 10, 10, 0xffff0000);
    (masked ? shape.mask : shape.filter) = "e";
    std::vector<SvgNode> inner;
    if (!masked) {
      SvgElement matrix{.kind = SvgKind::FeColorMatrix};
      matrix.op = 1;
      matrix.values = {0};
      inner.push_back(node(matrix));
    }
    auto canvas = NGNMakeCGCanvas(context, CGSizeMake(huge, huge), 1, nil);
    ngn::drawSvg({.root = node({.kind = SvgKind::Svg}, {node(effect, std::move(inner)), node(shape)})}, huge, huge, *canvas);
    canvas.reset();
    const uint8_t *p = &data[(5 * 20 + 5) * 4];
    INFO(std::string(masked ? "mask" : "filter"));
    CHECK(p[0] == 255);
    CHECK(p[3] == 255);
  }
  CGContextRelease(context);
}

TEST_CASE("every canvas waiting for the same image is told when it loads") {
  std::vector<uint8_t> data(4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), 1, 1, 8, 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  // A uri no earlier run has cached.
  std::string uri = "data:image/png;run=" + std::to_string(arc4random()) + ";base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  __block int first = 0, second = 0;
  auto a = NGNMakeCGCanvas(context, CGSizeMake(1, 1), 1, ^{ first++; });
  auto b = NGNMakeCGCanvas(context, CGSizeMake(1, 1), 1, ^{ second++; });
  a->image(uri, {.x = 0, .y = 0, .width = 1, .height = 1}, "none", 0, 1);
  b->image(uri, {.x = 0, .y = 0, .width = 1, .height = 1}, "none", 0, 1);
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:10];
  while ((first == 0 || second == 0) && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
  }
  CHECK(first == 1);
  CHECK(second == 1);
  CGContextRelease(context);
}

namespace {
// Answers every request for the scheme with bytes that are no image, and counts them.
int gBrokenRequests = 0;
}

@interface BrokenImageProtocol : NSURLProtocol
@end

@implementation BrokenImageProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
  return [request.URL.scheme isEqualToString:@"ngn-broken-image"];
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
  return request;
}
- (void)startLoading {
  gBrokenRequests++;
  NSURLResponse *response = [[NSURLResponse alloc] initWithURL:self.request.URL MIMEType:@"image/png" expectedContentLength:3 textEncodingName:nil];
  [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
  [self.client URLProtocol:self didLoadData:[NSData dataWithBytes:"abc" length:3]];
  [self.client URLProtocolDidFinishLoading:self];
}
- (void)stopLoading {
}
@end

TEST_CASE("an svg image that failed to load is not asked for again on later draws") {
  [NSURLProtocol registerClass:BrokenImageProtocol.class];
  gBrokenRequests = 0;
  std::vector<uint8_t> data(4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), 1, 1, 8, 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  std::string uri = "ngn-broken-image://host/" + std::to_string(arc4random()) + ".png";
  auto draw = [&] {
    auto canvas = NGNMakeCGCanvas(context, CGSizeMake(1, 1), 1, nil);
    canvas->image(uri, {.x = 0, .y = 0, .width = 1, .height = 1}, "none", 0, 1);
  };
  draw();
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:10];
  while (gBrokenRequests == 0 && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
  }
  // Let the failure reach the main queue, where it is recorded.
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.3, false);
  for (int i = 0; i < 3; i++) {
    draw();
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.3, false);
  }
  CHECK(gBrokenRequests == 1);
  [NSURLProtocol unregisterClass:BrokenImageProtocol.class];
  CGContextRelease(context);
}

// A layer that keeps the transform it is given, as the host's views' layers do (host-view.mm).
@interface FixedTransformLayer : CALayer
@property (nonatomic) CATransform3D kept;
@end

@implementation FixedTransformLayer
- (void)setTransform:(CATransform3D)transform {
  [super setTransform:_kept];
}
- (void)setKept:(CATransform3D)kept {
  _kept = kept;
  [super setTransform:kept];
}
@end

@interface TransformedView : NSView
@end

@implementation TransformedView
- (CALayer *)makeBackingLayer {
  FixedTransformLayer *layer = [FixedTransformLayer layer];
  layer.kept = CATransform3DIdentity;
  return layer;
}
@end

namespace {

NSView *layered(NSRect frame, CGColorRef background) {
  NSView *view = [[NSView alloc] initWithFrame:frame];
  view.wantsLayer = YES;
  view.layer.backgroundColor = background;
  return view;
}

} // namespace

TEST_CASE("a foreignObject draws its hidden views from their layers, at its corner, cut to its box, under what comes after") {
  CGColorRef red = CGColorCreateSRGB(1, 0, 0, 1), green = CGColorCreateSRGB(0, 1, 0, 1), blue = CGColorCreateSRGB(0, 0, 1, 1);
  // The views as the host mounts them: in the svg's view, under an element's hidden view.
  NSView *root = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 60, 60)];
  root.wantsLayer = YES;
  NSView *object = layered(NSMakeRect(0, 0, 60, 60), nil);
  object.hidden = YES;
  NSView *card = layered(NSMakeRect(2, 4, 40, 20), red);
  [card addSubview:layered(NSMakeRect(10, 10, 4, 4), green)];
  NSView *faded = layered(NSMakeRect(0, 30, 10, 10), red);
  faded.alphaValue = 0.5;
  NSView *gone = layered(NSMakeRect(20, 30, 10, 10), red);
  gone.hidden = YES;
  TransformedView *moved = [[TransformedView alloc] initWithFrame:NSMakeRect(0, 26, 4, 4)];
  moved.wantsLayer = YES;
  moved.layer.backgroundColor = red;
  ((FixedTransformLayer *)moved.layer).kept = CATransform3DMakeTranslation(20, 0, 0);
  for (NSView *v in @[ card, faded, gone, moved ]) {
    [object addSubview:v];
  }
  [root addSubview:object];
  // In a window, never shown, so the views' layers are in one tree.
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 60, 60)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  window.contentView = root;
  // AppKit puts the subviews' layers in the tree as the transaction commits, before the window
  // draws, as the svg view's drawRect does.
  [CATransaction flush];

  SvgElement foreign{.kind = SvgKind::ForeignObject};
  foreign.lengths = {{"x", len(10)}, {"y", len(10)}, {"width", len(30)}, {"height", len(40)}};
  foreign.view = 7;
  SvgNode drawing{node({.kind = SvgKind::Svg}, {node(foreign), node(rect(30, 10, 10, 10, 0xff0000ff))})};
  int w = 60, h = 60;
  std::vector<uint8_t> data(w * h * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), w, h, 8, w * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, h);
  CGContextScaleCTM(context, 1, -1);
  __block ngn::Tag asked = -1;
  auto canvas = NGNMakeCGCanvas(context, CGSizeMake(w, h), 1, nil, ^NSView *(ngn::Tag tag) {
    asked = tag;
    return object;
  });
  ngn::drawSvg({.root = std::move(drawing)}, w, h, *canvas);
  canvas.reset();
  CGContextRelease(context);
  auto at = [&](int x, int y) {
    const uint8_t *p = &data[(y * w + x) * 4];
    return show({p[0], p[1], p[2], p[3]});
  };
  CHECK(asked == 7);
  // The card at 10 + 2, 10 + 4, and the layer inside it.
  CHECK(at(13, 15) == "255,0,0,255");
  CHECK(at(11, 13) == "0,0,0,0");
  CHECK(at(23, 25) == "0,255,0,255");
  // Cut at the box's right edge, 40, though the card reaches 52; the rect after it drawn over it.
  CHECK(at(45, 20) == "0,0,0,0");
  CHECK(at(35, 15) == "0,0,255,255");
  // A view's own transform, from its frame's corner.
  CHECK(at(32, 38) == "255,0,0,255");
  CHECK(at(12, 38) == "0,0,0,0");
  // A view's own opacity, and a hidden view left out.
  CHECK(at(15, 45) == "128,0,0,128");
  CHECK(at(35, 45) == "0,0,0,0");
  CGColorRelease(red);
  CGColorRelease(green);
  CGColorRelease(blue);
}

TEST_CASE("a canvas with no way to find views draws a foreignObject's as nothing") {
  std::vector<uint8_t> data(4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(data.data(), 1, 1, 8, 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  auto canvas = NGNMakeCGCanvas(context, CGSizeMake(1, 1), 1, nil);
  canvas->views(7);
  canvas.reset();
  CHECK(data == std::vector<uint8_t>{0, 0, 0, 0});
  CGContextRelease(context);
}
