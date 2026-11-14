// `<split-view>` and its sidebar on AppKit (the core's split-view.h decides what is what):
//
// - The window's split view is an NSSplitViewController as the window's content view controller,
//   with the full-height sidebar, the toolbar's sidebar button and tracking separator, View > Show
//   Sidebar and autosave. A plain one is an NSSplitView in the content, at its Yoga frame.
// - Each pane is a container of its own (NGNSurfaceView) in its split item, and the size it is given
//   goes back to layout as the pane's state, at most once per display frame. The sidebar pane sits
//   below the title bar; the content pane runs under the toolbar, as a window's content does.
// - Each run of neighbouring sections is a source-list NSOutlineView in the sections' place. A
//   native row is drawn from the item's props; a custom row's views move into a container of their
//   own as the row's cell, which takes a click on something that takes it (rowContentTakesClick)
//   and otherwise lets the row select.
#pragma once

#import "host-view.h"

#include "ngn/input.h"
#include "ngn/split-view.h"

#include <functional>

// Views whose Fabric children the toolkit places itself, rather than as subviews.
@protocol NGNMountsChildren
- (void)mountChild:(NGNView *)child index:(NSInteger)index;
- (void)unmountChild:(NGNView *)child;
@end

// NgNativeSplitView.
@interface NGNSplitView : NGNView <NGNMountsChildren>
// Set once by the host: where the panes' and rows' containers report input, which views root a
// container of their own, and whether a click in a custom row is the content's.
@property (class, nonatomic) ngn::InputSink *input;
@property (class, nonatomic) std::function<void(NSInteger tag, BOOL isRoot)> containerRootChanged;
@property (class, nonatomic) std::function<bool(NSInteger rowTag, NSPoint point)> rowContentTakesClick;
// The window this split view is the content of, once it is the window's.
@property (nonatomic, readonly, weak) NSWindow *ownWindow;
// The core's decision (Sidebars::settle): the window's, or plain in the content.
- (void)placeAsWindows:(BOOL)window;
// The split view is leaving: the window gets its surface back.
- (void)uninstall;
@end

// NgNativeSidebar and NgNativeSplitContent: filled by their container, not placed by Yoga.
@interface NGNSplitPaneView : NGNView
@end

// NgNativeSidebarSection: a model object, never drawn.
@interface NGNSidebarSectionView : NGNView
@end

// NgNativeSidebarItem: a model object, or a custom row's views.
@interface NGNSidebarItemView : NGNView
@end

// The source lists among one parent's children.
@interface NGNSourceLists : NSObject
- (instancetype)initWithParent:(NGNView *)parent;
- (void)setLists:(const std::vector<ngn::SourceList> &)lists views:(NGNView * (^)(NSInteger tag))views;
// Lays each list out over its sections' frames, which Yoga may have moved.
- (void)layOut;
- (void)remove;
@end

// The window a surface shows in, even once a split view controller took its content: nil when none.
NSWindow *NGNWindowOfSplit(NSView *surfaceView);
