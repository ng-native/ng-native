// The material behind a <visual-effect> (visual-effect.h), set on an NSVisualEffectView in an
// offscreen window that is never shown.
#include "../visual-effect.h"

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

} // namespace

TEST_CASE("by default a visual effect is the sidebar's material, behind the window, following its state") {
  NSWindow *window = offscreenWindow();
  NSVisualEffectView *view = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
  [window.contentView addSubview:view];
  ngn::appkit::applyVisualEffect(view, ngn::VisualEffect{}, 0);
  CHECK(view.material == NSVisualEffectMaterialSidebar);
  CHECK(view.blendingMode == NSVisualEffectBlendingModeBehindWindow);
  CHECK(view.state == NSVisualEffectStateFollowsWindowActiveState);
  CHECK_FALSE(view.emphasized);
  CHECK_FALSE(view.layer.masksToBounds);
  [window close];
}

TEST_CASE("a visual effect takes the material, blending, state, emphasis and corners asked, and gives them back") {
  NSWindow *window = offscreenWindow();
  NSVisualEffectView *view = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
  [window.contentView addSubview:view];
  ngn::VisualEffect hud{
      .material = ngn::VisualEffect::Material::HudWindow,
      .blending = ngn::VisualEffect::Blending::WithinWindow,
      .state = ngn::VisualEffect::State::Active,
      .emphasized = true,
  };
  ngn::appkit::applyVisualEffect(view, hud, 10);
  CHECK(view.material == NSVisualEffectMaterialHUDWindow);
  CHECK(view.blendingMode == NSVisualEffectBlendingModeWithinWindow);
  CHECK(view.state == NSVisualEffectStateActive);
  CHECK(view.emphasized);
  CHECK(view.layer.cornerRadius == 10);
  CHECK(view.layer.masksToBounds);

  // Each material's name reaches AppKit's own.
  ngn::VisualEffect under{.material = ngn::VisualEffect::Material::UnderWindowBackground,
                          .state = ngn::VisualEffect::State::Inactive};
  ngn::appkit::applyVisualEffect(view, under, 0);
  CHECK(view.material == NSVisualEffectMaterialUnderWindowBackground);
  CHECK(view.blendingMode == NSVisualEffectBlendingModeBehindWindow);
  CHECK(view.state == NSVisualEffectStateInactive);
  CHECK_FALSE(view.emphasized);
  CHECK(view.layer.cornerRadius == 0);
  CHECK_FALSE(view.layer.masksToBounds);
  [window close];
}
