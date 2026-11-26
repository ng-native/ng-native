// The material behind a `<visual-effect>` (the core's visual-effect.h): an NSVisualEffectView set
// to the effect the props ask for.
#pragma once

#include "ngn/visual-effect.h"

#import <AppKit/AppKit.h>

namespace ngn::appkit {

// Sets `view`'s material, blending mode, state and emphasis to `effect`, and its corners to
// `radius`.
void applyVisualEffect(NSVisualEffectView *view, const VisualEffect &effect, CGFloat radius);

} // namespace ngn::appkit
