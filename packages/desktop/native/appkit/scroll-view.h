// ScrollView as a real NSScrollView: the content container mounts into its document view, the
// wheel, trackpad momentum and scrollers are AppKit's, and each scroll reports onScroll, updates
// the view's state and tells the core's hit test the new offset.
#pragma once

#import "host-view.h"

#include <functional>

@interface NGNScrollView : NGNView
// Called on the main thread as the content scrolls, with the view's tag and its offset.
@property (class, nonatomic) std::function<void(NSInteger, CGPoint)> offsetChanged;
@end
