// @react-native-masked-view/masked-view's view on macOS (the core's masked-view.h): its children
// drawn through its first child. The first child sits in a holder that is never drawn, as React
// Native's iOS view takes it out of the hierarchy; its layer is rendered into the mask of a
// container the other children mount into.
#pragma once

#import "host-view.h"
#import "split-view.h"

@interface NGNMaskedView : NGNView <NGNMountsChildren>
// Renders each masked view's mask again from its first child, after a transaction: the child's
// text, frame or children may have changed. Main thread.
+ (void)refreshMasks;
// `view` drew new content with no transaction behind it (an image that loaded, a masked view's own
// mask): the nearest masked view that masks with it renders its mask again.
+ (void)contentChangedIn:(NSView *)view;
@end
