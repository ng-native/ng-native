// A native stack's header as the window's NSToolbar: the screen in front's
// RNSScreenStackHeaderConfig fills it. Its title is the window title; a back chevron leads when the
// screen has one below it; left bar buttons and left header items follow it, and right ones
// trail. A header item's Angular content (an RNSScreenStackHeaderSubview) moves into its toolbar
// item as a container of its own, hit-tested from the item's root.
//
// The config view itself stays in the screen, hidden: on macOS the header is the window's.
#pragma once

#import "host-view.h"

#include "ngn/input.h"

#include <functional>

// RNSScreenStackHeaderConfig: never drawn in content.
@interface NGNHeaderConfigView : NGNView
@end

// RNSScreenStackHeaderSubview: placed by its toolbar item rather than by Yoga's origin.
@interface NGNHeaderSubviewView : NGNView
@end

@interface NGNHeaderToolbar : NSObject <NSToolbarDelegate>
// Set once by the host: where toolbar items' containers report input, and where the core learns
// which views root a container of their own.
@property (class, nonatomic) ngn::InputSink *input;
@property (class, nonatomic) std::function<void(NSInteger tag, BOOL isRoot)> containerRootChanged;

- (instancetype)initWithWindow:(NSWindow *)window;
// The window's content is a split view controller: the sidebar button and the tracking separator
// lead, and the toolbar shows even when no header does.
@property (nonatomic) BOOL sidebar;
// The header in front, or nil for none. `screen` hears the back button.
- (void)showConfig:(NGNHeaderConfigView *)config screen:(NGNView *)screen canGoBack:(BOOL)canGoBack;
// Rebuilds the bar when the config in front (or a view under it) changed.
- (void)refreshIfShowing:(NGNView *)view;
@end
