// react-native-svg's views on macOS. The RNSVGSvgView draws its document (ngn/svg.h), which the
// core builds from the elements under it, with Core Graphics; the elements' own views are
// hidden, as they draw nothing of their own. The views in a foreignObject stay hidden too: the svg
// draws them from their layers, so they take no clicks.
#pragma once

#import "host-view.h"

#include "ngn/svg.h"

#include <memory>

@interface NGNSvgView : NGNView
- (void)setDocument:(std::shared_ptr<const ngn::SvgDocument>)document;
@end

@interface NGNSvgElementView : NGNView
@end
