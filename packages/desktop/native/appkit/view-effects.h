// What a view's `filter` and `mix-blend-mode` become on its layer: Core Image filters and a
// compositing filter, which Core Animation applies to the layer and its sublayers.
#pragma once

#import <CoreImage/CoreImage.h>
#import <Foundation/Foundation.h>

#include "ngn/view-filter.h"

#include <react/renderer/graphics/BlendMode.h>

#include <vector>

namespace ngn::appkit {

// The layer's `filters` for the steps, in their order. Core Animation runs a layer's filters in a
// linear working space, where a colour matrix of the Filter Effects spec (written for sRGB values)
// would mix the channels wrongly, so the steps sit between the conversions to sRGB and back, and a
// colour step is clamped as the spec does. A drop shadow draws nothing: a layer filter cannot add
// a copy of the view under it. Nil when no step draws anything.
NSArray<CIFilter *> *layerFilters(const std::vector<FilterStep> &steps);

// The layer's `compositingFilter` for `mix-blend-mode`, which blends the view with what is drawn
// under it as React Native iOS does (RCTViewComponentView); nil for `normal`.
NSString *blendFilterName(facebook::react::BlendMode mode);

} // namespace ngn::appkit
