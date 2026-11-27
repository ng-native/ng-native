// @react-native-masked-view/masked-view's view (masked-view.mm): its children drawn through its
// first child, which is not drawn itself, as `<gradient-text>`'s letters mask its fill.
#import "../../masked-view.h"

#include "mounted-views.h"
#include "ngn/masked-view.h"

#include <doctest/doctest.h>

#include <objc/runtime.h>

#include <vector>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;

// What the masked view renders its mask with, counted by a test.
@interface NGNMaskedView (Render)
- (void)renderMask;
@end

namespace {

constexpr int kWidth = 200;
constexpr int kHeight = 100;

ShadowView at(Tag tag, const char *name, facebook::react::Rect frame, folly::dynamic props = folly::dynamic::object()) {
  auto view = ngn::testing::shadowView(tag, name, frame, viewProps(std::move(props)));
  view.surfaceId = MountedViews::kSurface;
  return view;
}

// The view's layers as they show on screen, one pixel to the point, row 0 at the top.
std::vector<uint8_t> drawn(NSView *view) {
  std::vector<uint8_t> data(static_cast<size_t>(kWidth) * kHeight * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context =
      CGBitmapContextCreate(data.data(), kWidth, kHeight, 8, kWidth * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, kHeight);
  CGContextScaleCTM(context, 1, -1);
  [view.layer renderInContext:context];
  CGContextRelease(context);
  return data;
}

struct Rgba {
  int r, g, b, a;
};
Rgba pixel(const std::vector<uint8_t> &data, int x, int y) {
  const uint8_t *p = &data[(static_cast<size_t>(y) * kWidth + x) * 4];
  return {p[0], p[1], p[2], p[3]};
}

} // namespace

TEST_CASE("A masked view draws its children through its first child, which it does not draw") {
  MountedViews mounted;
  constexpr int kRed = static_cast<int>(0xFFFF0000);
  constexpr int kBlack = static_cast<int>(0xFF000000);
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}));
  // The mask: opaque over the top half. The fill: red over the left half, so the mask's own black
  // would show over the right half if it were drawn.
  auto mask = at(6, "View", {{0, 0}, {kWidth, kHeight / 2}}, folly::dynamic::object("backgroundColor", kBlack));
  mounted.add(mask, 5);
  mounted.add(at(7, "View", {{0, 0}, {kWidth / 2, kHeight}}, folly::dynamic::object("backgroundColor", kRed)), 5);
  NSView *view = mounted.view(5);
  REQUIRE((view != nil));

  auto top = [&](const std::vector<uint8_t> &d) { return pixel(d, kWidth / 4, kHeight / 4); };
  auto bottom = [&](const std::vector<uint8_t> &d) { return pixel(d, kWidth / 4, kHeight * 3 / 4); };
  auto pixels = drawn(view);
  // Through the mask, the fill; outside it, nothing, and the mask's own black nowhere.
  CHECK(top(pixels).r > 240);
  CHECK(top(pixels).g < 16);
  CHECK(top(pixels).a > 240);
  CHECK(bottom(pixels).a < 16);
  CHECK(pixel(pixels, kWidth * 3 / 4, kHeight / 4).a < 16);

  // The mask moves to the bottom half: the fill shows there instead.
  auto moved = mask;
  moved.layoutMetrics.frame = {{0, kHeight / 2}, {kWidth, kHeight / 2}};
  mounted.mount({ShadowViewMutation::UpdateMutation(mounted.mounting->tree().find(6)->view, moved, 5)});
  pixels = drawn(view);
  CHECK(top(pixels).a < 16);
  CHECK(bottom(pixels).r > 240);
  CHECK(bottom(pixels).a > 240);
}

TEST_CASE("A masked view read as one element is named by the text of its children, the mask's included") {
  MountedViews mounted;
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("accessible", true)));
  mounted.add(at(6, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("accessibilityLabel", "Week")), 5);
  mounted.add(at(7, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("accessibilityLabel", "fill")), 5);
  NGNView *view = mounted.view(5);
  REQUIRE((view != nil));
  CHECK([view.accessibilityLabel isEqualToString:@"Week fill"]);
}

TEST_CASE("A masked view masks with its first child where its transform puts it") {
  MountedViews mounted;
  constexpr int kRed = static_cast<int>(0xFFFF0000);
  constexpr int kBlack = static_cast<int>(0xFF000000);
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}));
  // Laid out over the top half, moved down to the bottom half.
  auto down = folly::dynamic::array(folly::dynamic::object("translateY", kHeight / 2));
  mounted.add(at(6, "View", {{0, 0}, {kWidth, kHeight / 2}}, folly::dynamic::object("backgroundColor", kBlack)("transform", down)), 5);
  mounted.add(at(7, "View", {{0, 0}, {kWidth / 2, kHeight}}, folly::dynamic::object("backgroundColor", kRed)), 5);
  auto pixels = drawn(mounted.view(5));
  CHECK(pixel(pixels, kWidth / 4, kHeight / 4).a < 16);
  CHECK(pixel(pixels, kWidth / 4, kHeight * 3 / 4).r > 240);
  CHECK(pixel(pixels, kWidth / 4, kHeight * 3 / 4).a > 240);
}

TEST_CASE("A masked view masks again when an image that is its first child loads") {
  MountedViews mounted;
  constexpr int kRed = static_cast<int>(0xFFFF0000);
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}));
  mounted.add(at(6, "Image", {{0, 0}, {kWidth, kHeight}}), 5);
  mounted.add(at(7, "View", {{0, 0}, {kWidth / 2, kHeight}}, folly::dynamic::object("backgroundColor", kRed)), 5);
  // Nothing loaded yet: nothing shows.
  CHECK(pixel(drawn(mounted.view(5)), kWidth / 4, kHeight / 4).a < 16);

  // The image arrives, opaque over its top half, with no commit after it.
  NSImage *image = [NSImage imageWithSize:NSMakeSize(kWidth, kHeight)
                                  flipped:YES
                           drawingHandler:^BOOL(NSRect) {
                             [NSColor.blackColor setFill];
                             NSRectFill(NSMakeRect(0, 0, kWidth, kHeight / 2));
                             return YES;
                           }];
  [mounted.view(6) performSelector:@selector(loaded:) withObject:image];
  auto pixels = drawn(mounted.view(5));
  CHECK(pixel(pixels, kWidth / 4, kHeight / 4).r > 240);
  CHECK(pixel(pixels, kWidth / 4, kHeight / 4).a > 240);
  CHECK(pixel(pixels, kWidth / 4, kHeight * 3 / 4).a < 16);
}

TEST_CASE("A masked view that masks another masks with the inner one's new mask after a refresh") {
  MountedViews mounted;
  constexpr int kRed = static_cast<int>(0xFFFF0000);
  constexpr int kBlack = static_cast<int>(0xFF000000);
  // The outer view's mask is the inner masked view: black wherever the inner one's mask is.
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}));
  mounted.add(at(6, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}), 5);
  auto innerMask = at(7, "View", {{0, 0}, {kWidth, kHeight / 2}}, folly::dynamic::object("backgroundColor", kBlack));
  mounted.add(innerMask, 6);
  mounted.add(at(8, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("backgroundColor", kBlack)), 6);
  mounted.add(at(9, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("backgroundColor", kRed)), 5);
  auto top = [&](const std::vector<uint8_t> &d) { return pixel(d, kWidth / 2, kHeight / 4); };
  auto bottom = [&](const std::vector<uint8_t> &d) { return pixel(d, kWidth / 2, kHeight * 3 / 4); };
  auto pixels = drawn(mounted.view(5));
  CHECK(top(pixels).a > 240);
  CHECK(bottom(pixels).a < 16);

  // The inner mask moves to the bottom half: the outer view follows it in the same refresh.
  auto moved = innerMask;
  moved.layoutMetrics.frame = {{0, kHeight / 2}, {kWidth, kHeight / 2}};
  mounted.mount({ShadowViewMutation::UpdateMutation(mounted.mounting->tree().find(7)->view, moved, 6)});
  pixels = drawn(mounted.view(5));
  CHECK(top(pixels).a < 16);
  CHECK(bottom(pixels).r > 240);
  CHECK(bottom(pixels).a > 240);
}

TEST_CASE("A masked view in another's content does not make that one render its mask again") {
  MountedViews mounted;
  constexpr int kBlack = static_cast<int>(0xFF000000);
  // The outer view masks with a plain view; the inner masked view is in its content.
  mounted.add(at(5, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}));
  mounted.add(at(6, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("backgroundColor", kBlack)), 5);
  mounted.add(at(7, ngn::MaskedViewComponentName, {{0, 0}, {kWidth, kHeight}}), 5);
  auto innerMask = at(8, "View", {{0, 0}, {kWidth, kHeight / 2}}, folly::dynamic::object("backgroundColor", kBlack));
  mounted.add(innerMask, 7);
  mounted.add(at(9, "View", {{0, 0}, {kWidth, kHeight}}, folly::dynamic::object("backgroundColor", kBlack)), 7);
  NSView *outer = mounted.view(5);

  // Counts the outer view's renders while it lives.
  __block int renders = 0;
  Method method = class_getInstanceMethod(NGNMaskedView.class, @selector(renderMask));
  IMP original = method_getImplementation(method);
  IMP counting = imp_implementationWithBlock(^(NGNMaskedView *self) {
    if (self == outer) {
      renders++;
    }
    reinterpret_cast<void (*)(id, SEL)>(original)(self, @selector(renderMask));
  });
  method_setImplementation(method, counting);
  struct Restore {
    Method method;
    IMP original;
    IMP counting;
    ~Restore() {
      method_setImplementation(method, original);
      imp_removeBlock(counting);
    }
  } restore{method, original, counting};

  auto moved = innerMask;
  moved.layoutMetrics.frame = {{0, kHeight / 2}, {kWidth, kHeight / 2}};
  mounted.mount({ShadowViewMutation::UpdateMutation(mounted.mounting->tree().find(8)->view, moved, 7)});
  // Once, for the refresh after the commit: the inner view changing is not the outer one's mask.
  CHECK(renders == 1);
}
