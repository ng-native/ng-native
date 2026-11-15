// The material behind an <expo-glass> (glass-effect.h), made and drawn in an offscreen window that
// is never shown.
#include "../glass-effect.h"

#include <doctest/doctest.h>

namespace {

NSWindow *offscreenWindow() {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 120)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  return window;
}

// Draws `view` as the screen would, into a bitmap: what printing and drag images do.
NSBitmapImageRep *drawn(NSView *view) {
  NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  return rep;
}

} // namespace

TEST_CASE("before Liquid Glass, glass is a visual effect view, its style a material, in the view's corners") {
  NSWindow *window = offscreenWindow();
  ngn::Glass glass{.style = ngn::Glass::Style::Clear, .dark = true};
  NSView *effect = ngn::appkit::makeGlassEffect(glass, false);
  REQUIRE([effect isKindOfClass:NSVisualEffectView.class]);
  auto *visual = (NSVisualEffectView *)effect;
  CHECK(visual.material == NSVisualEffectMaterialFullScreenUI);
  CHECK(visual.blendingMode == NSVisualEffectBlendingModeWithinWindow);
  CHECK([visual.appearance.name isEqualToString:NSAppearanceNameDarkAqua]);
  effect.frame = window.contentView.bounds;
  [window.contentView addSubview:effect];
  ngn::appkit::updateGlassEffect(effect, ngn::Glass{}, 12);
  CHECK(visual.material == NSVisualEffectMaterialPopover);
  CHECK(visual.layer.cornerRadius == 12);
  CHECK(visual.layer.masksToBounds);
  CHECK((visual.appearance == nil));
  CHECK(drawn(window.contentView).pixelsWide >= 200);
  [window close];
}

TEST_CASE("on a Mac with Liquid Glass, glass is NSGlassEffectView with the style, tint and corners asked") {
  if (!ngn::appkit::liquidGlassAvailable()) {
    MESSAGE("this Mac has no NSGlassEffectView: only the fallback is checked");
    return;
  }
  NSWindow *window = offscreenWindow();
  ngn::Glass glass{.style = ngn::Glass::Style::Clear, .tint = facebook::react::colorFromRGBA(10, 132, 255, 51)};
  NSView *effect = ngn::appkit::makeGlassEffect(glass, true);
  CHECK([NSStringFromClass(effect.class) isEqualToString:@"NSGlassEffectView"]);
  CHECK([[effect valueForKey:@"style"] integerValue] == 1);
  NSColor *tint = [effect valueForKey:@"tintColor"];
  REQUIRE((tint != nil));
  CHECK(tint.alphaComponent == doctest::Approx(0.2).epsilon(0.01));
  ngn::appkit::updateGlassEffect(effect, ngn::Glass{}, 16);
  CHECK([[effect valueForKey:@"style"] integerValue] == 0);
  CHECK([[effect valueForKey:@"cornerRadius"] doubleValue] == 16);
  CHECK(([effect valueForKey:@"tintColor"] == nil));
  effect.frame = window.contentView.bounds;
  [window.contentView addSubview:effect];
  CHECK(drawn(window.contentView).pixelsHigh >= 120);
  [window close];
}
