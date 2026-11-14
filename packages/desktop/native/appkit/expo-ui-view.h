// `@expo/ui`'s views on macOS (the core's expo-ui.h). A HostView is an NGNView holding the SwiftUI
// content of its tree (expo-ui-renderer.h), which it sends each view's events from, and whose size
// it reports as its state when it matches its content. Every other expo/ui view is a hidden NGNView
// that mounts none of its children, since SwiftUI draws them, except an RNHostView: the app's own
// views, which the SwiftUI content holds where the RNHostView is.
#pragma once

#import "host-view.h"
#import "split-view.h"

#include "ngn/expo-ui.h"

#include <memory>

@interface NGNExpoUIView : NGNView <NGNMountsChildren>
@end

@interface NGNExpoUIHostView : NGNView <NGNMountsChildren>
- (void)setTree:(std::shared_ptr<const ngn::ExpoUINode>)tree;
@end

@interface NGNExpoUIEmbeddedView : NGNView
@end

// The view for an expo/ui component, or nil for another component.
NGNView *NGNMakeExpoUIView(const facebook::react::ShadowView &view);
