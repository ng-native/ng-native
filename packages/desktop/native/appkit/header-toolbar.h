// A native stack's header as the window's NSToolbar: the screen in front's
// RNSScreenStackHeaderConfig fills it. Its title is the window title; the back and forward chevrons
// lead when the window has history (or back alone when the app reports none and the screen has
// one below it), each listing its way's entries on a long press or a secondary click; left bar
// buttons and left header items follow it, and right ones trail, then the search bar of a
// searchBar header item as an NSSearchToolbarItem. A header item's Angular content (an
// RNSScreenStackHeaderSubview) moves into its toolbar item as a container of its own, hit-tested
// from the item's root.
//
// The config view itself stays in the screen, hidden: on macOS the header is the window's.
#pragma once

#import "host-view.h"

#include "ngn/app-menus.h"
#include "ngn/input.h"

#include <functional>

// RNSScreenStackHeaderConfig: never drawn in content.
@interface NGNHeaderConfigView : NGNView
@end

// RNSScreenStackHeaderSubview: placed by its toolbar item rather than by Yoga's origin.
@interface NGNHeaderSubviewView : NGNView
@end

@class NGNSearchToolbarItem;

// RNSSearchBar, in a header item of type searchBar: never drawn in content. Its field is the
// toolbar's NGNSearchToolbarItem (search-toolbar-item.h), which this view owns, so commands reach it
// whether or not the header is in front.
@interface NGNSearchBarView : NGNView
@property (nonatomic, readonly) NGNSearchToolbarItem *item;
@end

@interface NGNHeaderToolbar : NSObject <NSToolbarDelegate>
// Set once by the host: where toolbar items' containers report input, and where the core learns
// which views root a container of their own.
@property (class, nonatomic) ngn::InputSink *input;
@property (class, nonatomic) std::function<void(NSInteger tag, BOOL isRoot)> containerRootChanged;
// Set once by the host: where a chevron's click, or a pick from its menu, goes when the window
// reports its history.
@property (class, nonatomic)
    std::function<void(NSWindow *window, ngn::NavigationDirection direction, int steps)> navigate;

- (instancetype)initWithWindow:(NSWindow *)window;
// The window's content is a split view controller: the sidebar button and the tracking separator
// lead, and the toolbar shows even when no header does, while it has the sidebar button or the
// history chevrons to show.
@property (nonatomic) BOOL sidebar;
// Whether the sidebar button leads while `sidebar` is set: yes unless the window's sidebar turns it
// off. The tracking separator stays either way.
@property (nonatomic) BOOL sidebarToggle;
// The header in front, or nil for none. `screen` hears the back button.
- (void)showConfig:(NGNHeaderConfigView *)config screen:(NGNView *)screen canGoBack:(BOOL)canGoBack;
// A secondary click on a chevron shows its way's entries, in place of the toolbar's own menu that
// the toolbar would show. True when it did.
+ (BOOL)showHistoryMenuForEvent:(NSEvent *)event;
// The window's history as the app reports it, or nothing for an app that reports none.
- (void)showHistory:(const std::optional<ngn::WindowHistory> &)history;
// Rebuilds the bar when the config in front (or a view under it) changed.
- (void)refreshIfShowing:(NGNView *)view;
@end
