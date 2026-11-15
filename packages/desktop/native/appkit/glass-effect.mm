#import "glass-effect.h"

#include <react/renderer/graphics/Color.h>

namespace ngn::appkit {

namespace {

NSColor *colorOf(const facebook::react::SharedColor &color) {
  if (!color) {
    return nil;
  }
  auto rgba = facebook::react::colorComponentsFromColor(color);
  return [NSColor colorWithSRGBRed:rgba.red green:rgba.green blue:rgba.blue alpha:rgba.alpha];
}

// NSGlassEffectViewStyleRegular and NSGlassEffectViewStyleClear.
constexpr NSInteger kGlassRegular = 0;
constexpr NSInteger kGlassClear = 1;

} // namespace

bool liquidGlassAvailable() {
  return NSClassFromString(@"NSGlassEffectView") != nil;
}

NSView *makeGlassEffect(const Glass &glass, bool liquid) {
  NSView *effect = nil;
  if (Class glassClass = liquid ? NSClassFromString(@"NSGlassEffectView") : nil) {
    effect = [[glassClass alloc] initWithFrame:NSZeroRect];
  } else {
    NSVisualEffectView *visual = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    visual.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    visual.state = NSVisualEffectStateActive;
    effect = visual;
  }
  effect.wantsLayer = YES;
  effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  updateGlassEffect(effect, glass, 0);
  return effect;
}

void updateGlassEffect(NSView *effect, const Glass &glass, CGFloat radius) {
  if (glass.dark) {
    effect.appearance = [NSAppearance appearanceNamed:*glass.dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  } else {
    effect.appearance = nil;
  }
  if ([effect isKindOfClass:NSVisualEffectView.class]) {
    auto *visual = (NSVisualEffectView *)effect;
    // Regular glass is frosted like a popover; clear lets more through.
    visual.material = glass.style == Glass::Style::Clear ? NSVisualEffectMaterialFullScreenUI : NSVisualEffectMaterialPopover;
    visual.layer.cornerRadius = radius;
    visual.layer.masksToBounds = radius > 0;
    visual.layer.backgroundColor = colorOf(glass.tint).CGColor;
    return;
  }
  [effect setValue:@(glass.style == Glass::Style::Clear ? kGlassClear : kGlassRegular) forKey:@"style"];
  [effect setValue:@(radius) forKey:@"cornerRadius"];
  [effect setValue:colorOf(glass.tint) forKey:@"tintColor"];
}

} // namespace ngn::appkit
