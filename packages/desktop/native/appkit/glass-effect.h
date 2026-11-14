// The material an `<expo-glass>` draws behind its children (the core's glass.h): Liquid Glass,
// NSGlassEffectView, from macOS 26, and an NSVisualEffectView before it. Found by name, so a host
// built with an older SDK still draws Liquid Glass on macOS 26.
#pragma once

#include "ngn/glass.h"

#import <AppKit/AppKit.h>

namespace ngn::appkit {

// Whether this Mac has NSGlassEffectView.
bool liquidGlassAvailable();

// A new view of the material for `glass`: NSGlassEffectView where `liquid` and the Mac has it,
// else an NSVisualEffectView.
NSView *makeGlassEffect(const Glass &glass, bool liquid);

// Sets `effect`'s style, tint, appearance and corners to `glass` and `radius`.
void updateGlassEffect(NSView *effect, const Glass &glass, CGFloat radius);

} // namespace ngn::appkit
