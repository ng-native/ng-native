#import <React/RCTBridgeModule.h>
#import <React/RCTComponentViewFactory.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#import "NgNativeSplitViewDelegate.h"
#import "NgNativeSplitViewShadowNodes.h"

#include <optional>

using namespace facebook::react;

/**
 `<split-view>` on an iPad: a UISplitViewController with a sidebar column and a content column.

 - `NgNativeSplitView` holds the controller, a child of the view controller the split view is in,
   and puts its two Fabric children in the columns: `NgNativeSidebar` in the primary one, with the
   sidebar's material behind it, and `NgNativeSplitContent` in the secondary one. Each column's
   frame in the split view goes into its node's state, so Yoga lays out what is in it at that
   size, and a measurement inside it counts the column's offset and its navigation bar.
 - The sidebar's `collapsed` hides or shows the primary column, and `paneMinWidth` and
   `paneMaxWidth` bound its width. The sidebar button, and the swipe that opens or shuts it, send
   `topSidebarCollapse` to the sidebar; UIKit hiding the sidebar at a narrower width does not, and
   it shows again at a wider one. `NgNativeSplitViewDelegate` tells the two apart.
 - At a compact width (Slide Over, a narrow Split View) UIKit collapses the columns into a
   navigation stack. Its root is the sidebar, unless the app had shown the content; the command
   `showContent` pushes the content there and `showSidebar` pops it. Both columns stay mounted, so
   what the content shows, the router's page among it, is kept as the width changes.
 - The `NgNativeSplitViews` module's constant `available` is true on an iPad, where JavaScript then
   names these views; an iPhone draws the split view from views.
 */
@class NgNativeSplitPaneView;

/** A column's view controller: it hosts one pane, placed under the column's navigation bar. */
@interface NgNativeSplitColumn : UIViewController
@property (nonatomic, weak, nullable) NgNativeSplitPaneView *pane;
/** The split view's Fabric view, whose coordinates the pane's node is laid out in. */
@property (nonatomic, weak, nullable) UIView *splitView;
- (CGRect)paneArea;
- (void)host:(NgNativeSplitPaneView *)pane;
@end

/** A column's Fabric view, whose frame is the column's rather than Yoga's. */
@interface NgNativeSplitPaneView : RCTViewComponentView
@property (nonatomic, weak, nullable) NgNativeSplitColumn *column;
- (void)ngn_columnPlaced:(CGRect)frame;
@end

@interface NgNativeSplitViewComponentView : RCTViewComponentView
- (void)ngn_sidebarChanged;
@end

@interface NgNativeSidebarComponentView : NgNativeSplitPaneView
@property (nonatomic, weak, nullable) NgNativeSplitViewComponentView *splitView;
@property (nonatomic, readonly) const NgNativeSidebarProps &sidebarProps;
- (void)ngn_sendCollapsed:(BOOL)collapsed;
@end

@interface NgNativeSplitContentComponentView : NgNativeSplitPaneView
@end

#pragma mark - Columns

@implementation NgNativeSplitColumn

- (void)host:(NgNativeSplitPaneView *)pane
{
  self.pane = pane;
  pane.column = self;
  [self.view addSubview:pane];
  [self.view setNeedsLayout];
}

/**
 Inside the column's safe area but for its bottom edge: below its navigation bar, and beside the
 sidebar, which from iOS 26 floats over the content column rather than beside it.
 */
- (CGRect)paneArea
{
  CGRect bounds = self.view.bounds;
  UIEdgeInsets insets = self.view.safeAreaInsets;
  insets.bottom = 0;
  CGRect area = UIEdgeInsetsInsetRect(bounds, insets);
  return area.size.width > 0 && area.size.height > 0 ? area : bounds;
}

- (void)viewDidLayoutSubviews
{
  [super viewDidLayoutSubviews];
  NgNativeSplitPaneView *pane = self.pane;
  if (pane == nil || pane.superview != self.view) {
    return;
  }
  CGRect area = [self paneArea];
  pane.frame = area;
  // Where the split view's node lays the pane's out: across from the sidebar, below the bar.
  UIView *splitView = self.splitView;
  CGRect placed = area;
  if (splitView != nil && splitView.window != nil && splitView.window == self.view.window) {
    placed = [self.view convertRect:area toView:splitView];
  }
  [pane ngn_columnPlaced:placed];
  id delegate = self.splitViewController.delegate;
  if ([delegate isKindOfClass:[NgNativeSplitViewDelegate class]]) {
    [(NgNativeSplitViewDelegate *)delegate columnLaidOut];
  }
}

- (void)viewSafeAreaInsetsDidChange
{
  [super viewSafeAreaInsetsDidChange];
  [self.view setNeedsLayout];
}

@end

@implementation NgNativeSplitPaneView

+ (BOOL)shouldBeRecycled
{
  // The view is placed in a column controller, not in the view Fabric mounts it in.
  return NO;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  NgNativeSplitColumn *column = self.column;
  if (column != nil && self.superview == column.view) {
    // The node has the column's frame in the split view; the view sits in the column itself.
    self.frame = [column paneArea];
  }
}

- (void)ngn_columnPlaced:(CGRect)frame
{
}

@end

#pragma mark - The sidebar and content columns

/**
 A column's frame into its node's state, where it changed, its origin alone among it: Yoga then
 lays the column out at its size, and the node sits at its origin. The state updates later, so a
 frame is compared with the last one asked for, not the last committed: a column that goes from A
 to B and back to A before B commits still asks for A, after B.
 */
template <class StateT>
static void putColumnFrame(
    const std::shared_ptr<const StateT> &state,
    std::optional<facebook::react::Rect> &requested,
    CGRect frame)
{
  if (state == nullptr) {
    return;
  }
  facebook::react::Rect next{
      .origin = {.x = (Float)frame.origin.x, .y = (Float)frame.origin.y},
      .size = {.width = (Float)frame.size.width, .height = (Float)frame.size.height}};
  const auto &committed = state->getData();
  if (next == requested.value_or(facebook::react::Rect{.origin = committed.origin, .size = committed.size})) {
    return;
  }
  requested = next;
  state->updateState(NgNativeSplitPaneState(next));
}

@implementation NgNativeSidebarComponentView {
  NgNativeSidebarShadowNode::ConcreteState::Shared _state;
  std::optional<facebook::react::Rect> _requestedFrame;
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NgNativeSidebarComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = NgNativeSidebarShadowNode::defaultSharedProps();
  }
  return self;
}

- (const NgNativeSidebarProps &)sidebarProps
{
  return static_cast<const NgNativeSidebarProps &>(*_props);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  [self.splitView ngn_sidebarChanged];
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState
{
  _state = std::static_pointer_cast<const NgNativeSidebarShadowNode::ConcreteState>(state);
}

- (void)ngn_columnPlaced:(CGRect)frame
{
  putColumnFrame(_state, _requestedFrame, frame);
}

- (void)ngn_sendCollapsed:(BOOL)collapsed
{
  if (_eventEmitter) {
    std::static_pointer_cast<const NgNativeSidebarEventEmitter>(_eventEmitter)->onSidebarCollapse(collapsed);
  }
}

@end

@implementation NgNativeSplitContentComponentView {
  NgNativeSplitContentShadowNode::ConcreteState::Shared _state;
  std::optional<facebook::react::Rect> _requestedFrame;
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NgNativeSplitContentComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = NgNativeSplitContentShadowNode::defaultSharedProps();
  }
  return self;
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState
{
  _state = std::static_pointer_cast<const NgNativeSplitContentShadowNode::ConcreteState>(state);
}

- (void)ngn_columnPlaced:(CGRect)frame
{
  putColumnFrame(_state, _requestedFrame, frame);
}

@end

#pragma mark - The split view

@implementation NgNativeSplitViewComponentView {
  UISplitViewController *_controller;
  NgNativeSplitColumn *_sidebarColumn;
  NgNativeSplitColumn *_contentColumn;
  NgNativeSplitViewDelegate *_delegate;
  __weak NgNativeSidebarComponentView *_sidebar;
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NgNativeSplitViewComponentDescriptor>();
}

+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = NgNativeSplitViewShadowNode::defaultSharedProps();
    _controller = [[UISplitViewController alloc] initWithStyle:UISplitViewControllerStyleDoubleColumn];
    _delegate = [[NgNativeSplitViewDelegate alloc] initWithController:_controller];
    __weak NgNativeSplitViewComponentView *weakSelf = self;
    _delegate.onCollapse = ^(BOOL collapsed) {
      NgNativeSplitViewComponentView *strongSelf = weakSelf;
      if (strongSelf != nil) {
        [strongSelf->_sidebar ngn_sendCollapsed:collapsed];
      }
    };
    _controller.delegate = _delegate;
    _controller.primaryBackgroundStyle = UISplitViewControllerBackgroundStyleSidebar;
    _controller.preferredSplitBehavior = UISplitViewControllerSplitBehaviorTile;
    _controller.preferredDisplayMode = UISplitViewControllerDisplayModeOneBesideSecondary;
    _sidebarColumn = [NgNativeSplitColumn new];
    _sidebarColumn.splitView = self;
    _contentColumn = [NgNativeSplitColumn new];
    _contentColumn.splitView = self;
    [_controller setViewController:_sidebarColumn forColumn:UISplitViewControllerColumnPrimary];
    [_controller setViewController:_contentColumn forColumn:UISplitViewControllerColumnSecondary];
    self.contentView = _controller.view;
  }
  return self;
}

#pragma mark Containment

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window == nil) {
    [self ngn_leaveParent];
    return;
  }
  UIViewController *parent = [self ngn_parentController];
  if (parent == nil || _controller.parentViewController == parent) {
    return;
  }
  [self ngn_leaveParent];
  [parent addChildViewController:_controller];
  [_controller didMoveToParentViewController:parent];
}

- (void)ngn_leaveParent
{
  if (_controller.parentViewController == nil) {
    return;
  }
  [_controller willMoveToParentViewController:nil];
  [_controller removeFromParentViewController];
}

/** The nearest view controller above this view, which the split view controller joins. */
- (nullable UIViewController *)ngn_parentController
{
  for (UIResponder *responder = self.superview; responder != nil; responder = responder.nextResponder) {
    if ([responder isKindOfClass:[UIViewController class]]) {
      return (UIViewController *)responder;
    }
  }
  return nil;
}

#pragma mark Children

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  if ([childComponentView isKindOfClass:[NgNativeSidebarComponentView class]]) {
    NgNativeSidebarComponentView *sidebar = (NgNativeSidebarComponentView *)childComponentView;
    _sidebar = sidebar;
    sidebar.splitView = self;
    [_sidebarColumn host:sidebar];
    [self ngn_sidebarChanged];
    return;
  }
  if ([childComponentView isKindOfClass:[NgNativeSplitContentComponentView class]]) {
    [_contentColumn host:(NgNativeSplitPaneView *)childComponentView];
    return;
  }
  [super mountChildComponentView:childComponentView index:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  if ([childComponentView isKindOfClass:[NgNativeSplitPaneView class]]) {
    NgNativeSplitPaneView *pane = (NgNativeSplitPaneView *)childComponentView;
    if (pane.column.pane == pane) {
      pane.column.pane = nil;
    }
    pane.column = nil;
    if (pane == _sidebar) {
      _sidebar.splitView = nil;
      _sidebar = nil;
    }
    [pane removeFromSuperview];
    return;
  }
  [super unmountChildComponentView:childComponentView index:index];
}

#pragma mark The sidebar's props

- (void)ngn_sidebarChanged
{
  NgNativeSidebarComponentView *sidebar = _sidebar;
  if (sidebar == nil) {
    return;
  }
  const auto &props = sidebar.sidebarProps;
  _controller.minimumPrimaryColumnWidth =
      props.paneMinWidth > 0 ? props.paneMinWidth : UISplitViewControllerAutomaticDimension;
  _controller.maximumPrimaryColumnWidth =
      props.paneMaxWidth > 0 ? props.paneMaxWidth : UISplitViewControllerAutomaticDimension;
  [_delegate setCollapsed:props.collapsed];
}

#pragma mark Commands

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  if ([commandName isEqualToString:@"showContent"]) {
    [_delegate showContent];
  } else if ([commandName isEqualToString:@"showSidebar"]) {
    [_delegate showSidebar];
  }
}

@end

#pragma mark - The module

@interface NgNativeSplitViews : NSObject <RCTBridgeModule>
@end

@implementation NgNativeSplitViews

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSDictionary *)constantsToExport
{
  return @{@"available" : @(UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad)};
}

@end
