#import "scroll-view.h"

#import "scrollers.h"

#include <react/renderer/components/scrollview/ScrollViewEventEmitter.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {
std::function<void(NSInteger, CGPoint)> gOffsetChanged;
}

@interface NGNScrollDocumentView : NSView
@end

@implementation NGNScrollDocumentView
- (BOOL)isFlipped {
  return YES;
}
@end

@implementation NGNScrollView {
  NGNWheelScrollView *_scrollView;
  NGNScrollDocumentView *_document;
  State::Shared _scrollState;
  BOOL _applyingState;
  BOOL _showsVertical;
  BOOL _showsHorizontal;
  NGNScrollerStyleObserver *_styleObserver;
  // The `contentOffset` prop last read, and one not yet applied: it waits for the content's size
  // and the view's, and is applied once, as the prop arrives or changes.
  std::optional<facebook::react::Point> _offsetProp;
  std::optional<facebook::react::Point> _pendingOffset;
  BOOL _offsetQueued;
}

+ (std::function<void(NSInteger, CGPoint)>)offsetChanged {
  return gOffsetChanged;
}

+ (void)setOffsetChanged:(std::function<void(NSInteger, CGPoint)>)offsetChanged {
  gOffsetChanged = std::move(offsetChanged);
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _scrollView = [[NGNWheelScrollView alloc] initWithFrame:NSZeroRect];
    _scrollView.drawsBackground = NO;
    _scrollView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _scrollView.autohidesScrollers = YES;
    // The user's "Show scroll bars" setting. A legacy scroller's strip is a gutter the content is
    // laid out without (scrollers.h).
    _scrollView.scrollerStyle = NSScroller.preferredScrollerStyle;
    _showsVertical = YES;
    _showsHorizontal = YES;
    _document = [[NGNScrollDocumentView alloc] initWithFrame:NSZeroRect];
    _scrollView.documentView = _document;
    _scrollView.contentView.postsBoundsChangedNotifications = YES;
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(boundsDidChange:)
                                               name:NSViewBoundsDidChangeNotification
                                             object:_scrollView.contentView];
    [self addSubview:_scrollView];
    __weak NGNScrollView *weakSelf = self;
    _scrollView.phaseChanged = ^(NGNScrollPhase phase, NSPoint velocity) {
      [weakSelf report:phase velocity:velocity];
    };
    _styleObserver = [[NGNScrollerStyleObserver alloc] initWithChanged:^{
      [weakSelf updateScrollers];
    }];
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  ngn::ScrollerGutters::shared().remove(self.reactTag);
}

- (NSView *)contentContainer {
  return _document;
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto p = std::dynamic_pointer_cast<const ScrollViewProps>(props);
  if (!p) {
    return;
  }
  _showsVertical = p->showsVerticalScrollIndicator;
  _showsHorizontal = p->showsHorizontalScrollIndicator;
  [self updateScrollers];
  _scrollView.verticalScrollElasticity = p->bounces ? NSScrollElasticityAutomatic : NSScrollElasticityNone;
  _scrollView.horizontalScrollElasticity = _scrollView.verticalScrollElasticity;
  // The inner scroll view takes the wheel before this view does.
  _scrollView.scrollingDisabled = !p->scrollEnabled;
  _scrollView.pagingEnabled = p->pagingEnabled;
  if (_offsetProp != p->contentOffset) {
    bool first = !_offsetProp;
    _offsetProp = p->contentOffset;
    if (!first || p->contentOffset != facebook::react::Point{}) {
      _pendingOffset = p->contentOffset;
    }
    [self applyPendingOffsetAfterMount];
  }
}

// After the rest of this mount: its state and its layout, which come after the props in that
// order, give the content's size and the view's. Once, however many of them change.
- (void)applyPendingOffsetAfterMount {
  if (!_pendingOffset || _offsetQueued) {
    return;
  }
  _offsetQueued = YES;
  __weak NGNScrollView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    NGNScrollView *strong = weakSelf;
    if (strong != nil) {
      strong->_offsetQueued = NO;
      [strong applyPendingOffset];
    }
  });
}

// The starting offset the props ask for, within the content, once there is content to scroll. The
// viewport is the clip view's, which a legacy scroller's gutter makes smaller than this view.
- (void)applyPendingOffset {
  NSSize doc = _document.frame.size, view = _scrollView.contentView.bounds.size;
  if (!_pendingOffset || doc.width <= 0 || doc.height <= 0 || view.width <= 0 || view.height <= 0) {
    return;
  }
  NSPoint target = NSMakePoint(std::clamp<CGFloat>(_pendingOffset->x, 0, std::max<CGFloat>(0, doc.width - view.width)),
                               std::clamp<CGFloat>(_pendingOffset->y, 0, std::max<CGFloat>(0, doc.height - view.height)));
  _pendingOffset.reset();
  NSClipView *clip = _scrollView.contentView;
  [clip scrollToPoint:target];
  [_scrollView reflectScrolledClipView:clip];
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  _scrollView.frame = self.bounds;
  [self updateScrollers];
  [self applyPendingOffsetAfterMount];
}

- (void)updateDesktopProps:(const ngn::DesktopProps &)props {
  [super updateDesktopProps:props];
  [self updateScrollers];
}

// The scrollers the core says show (scrollers.h), in the user's style; `thin` draws AppKit's small
// ones. When a legacy scroller's gutter changes, the content is laid out again without it.
- (void)updateScrollers {
  const auto &desktop = self.desktopProps;
  NSSize content = _document.frame.size, view = self.bounds.size;
  auto visibility = ngn::scrollerVisibility(
      desktop,
      _showsVertical,
      _showsHorizontal,
      {static_cast<Float>(content.width), static_cast<Float>(content.height)},
      {static_cast<Float>(view.width), static_cast<Float>(view.height)});
  _scrollView.scrollerStyle = NSScroller.preferredScrollerStyle;
  _scrollView.hasVerticalScroller = visibility.vertical;
  _scrollView.hasHorizontalScroller = visibility.horizontal;
  _scrollView.autohidesScrollers = visibility.autohides;
  BOOL thin = desktop.scrollbarWidth == ngn::ScrollbarWidth::Thin;
  NSControlSize size = thin ? NSControlSizeSmall : NSControlSizeRegular;
  _scrollView.verticalScroller.controlSize = size;
  _scrollView.horizontalScroller.controlSize = size;
  auto gutter = ngn::scrollerGutter(NGNPreferredScrollerStyle(), NGNLegacyScrollerWidth(thin), visibility);
  // Recorded only once there is a state to update, so a gutter is never recorded that no layout
  // has asked for.
  if (_scrollState && ngn::ScrollerGutters::shared().set(self.reactTag, gutter)) {
    [self layOutAgain];
  }
}

// A state update clones the scroll view's node, which reads its gutter (scrollers.h).
- (void)layOutAgain {
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ScrollViewState>>(_scrollState);
  if (concrete) {
    concrete->updateState(ScrollViewState(concrete->getData()));
  }
}

- (void)updateState:(const State::Shared &)state {
  [super updateState:state];
  _scrollState = state;
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ScrollViewState>>(state);
  if (!concrete) {
    return;
  }
  auto size = concrete->getData().getContentSize();
  _applyingState = YES;
  [_document setFrameSize:NSMakeSize(size.width, size.height)];
  _applyingState = NO;
  [self updateScrollers];
  [self applyPendingOffsetAfterMount];
}

- (void)boundsDidChange:(NSNotification *)note {
  NSPoint origin = _scrollView.contentView.bounds.origin;
  if (gOffsetChanged) {
    gOffsetChanged(self.reactTag, origin);
  }
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ScrollViewState>>(_scrollState);
  if (concrete && !_applyingState) {
    auto data = concrete->getData();
    data.contentOffset = {static_cast<Float>(origin.x), static_cast<Float>(origin.y)};
    concrete->updateState(std::move(data));
  }
  auto emitter = std::dynamic_pointer_cast<const ScrollViewEventEmitter>(self.eventEmitter);
  if (emitter) {
    emitter->onScroll([self scrollEvent]);
  }
}

- (ScrollEvent)scrollEvent {
  NSPoint origin = _scrollView.contentView.bounds.origin;
  ScrollEvent event;
  event.contentOffset = {static_cast<Float>(origin.x), static_cast<Float>(origin.y)};
  event.contentSize = {static_cast<Float>(_document.frame.size.width), static_cast<Float>(_document.frame.size.height)};
  event.containerSize = {static_cast<Float>(self.bounds.size.width), static_cast<Float>(self.bounds.size.height)};
  event.zoomScale = 1;
  event.timestamp = NSProcessInfo.processInfo.systemUptime;
  return event;
}

// A trackpad gesture's drag and momentum, as onScrollBeginDrag, onScrollEndDrag,
// onMomentumScrollBegin and onMomentumScrollEnd report a touch's on iOS.
- (void)report:(NGNScrollPhase)phase velocity:(NSPoint)velocity {
  auto emitter = std::dynamic_pointer_cast<const ScrollViewEventEmitter>(self.eventEmitter);
  if (!emitter) {
    return;
  }
  switch (phase) {
    case NGNScrollPhaseDragBegan:
      emitter->onScrollBeginDrag([self scrollEvent]);
      break;
    case NGNScrollPhaseDragEnded: {
      ScrollEndDragEvent event([self scrollEvent]);
      event.velocity = {static_cast<Float>(velocity.x), static_cast<Float>(velocity.y)};
      event.targetContentOffset = event.contentOffset;
      emitter->onScrollEndDrag(event);
      break;
    }
    case NGNScrollPhaseMomentumBegan:
      emitter->onMomentumScrollBegin([self scrollEvent]);
      break;
    case NGNScrollPhaseMomentumEnded:
      emitter->onMomentumScrollEnd([self scrollEvent]);
      break;
  }
}

- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
  NSClipView *clip = _scrollView.contentView;
  NSPoint target = clip.bounds.origin;
  if (name == "scrollTo" && args.isArray() && args.size() >= 2) {
    target = NSMakePoint(args[0].asDouble(), args[1].asDouble());
  } else if (name == "scrollToEnd") {
    NSSize doc = _document.frame.size, view = clip.bounds.size;
    target = NSMakePoint(std::max<CGFloat>(0, doc.width - view.width), std::max<CGFloat>(0, doc.height - view.height));
    if (doc.height > view.height) {
      target.x = clip.bounds.origin.x;
    }
  } else {
    return;
  }
  // scrollTo's third argument, and scrollToEnd's only one, is whether it animates.
  const auto &animated = name == "scrollTo" ? (args.size() >= 3 ? args[2] : folly::dynamic()) : (args.isArray() && !args.empty() ? args[0] : folly::dynamic());
  if (animated.isBool() && animated.asBool()) {
    NGNWheelScrollView *scroll = _scrollView;
    [NSAnimationContext
        runAnimationGroup:^(NSAnimationContext *context) {
          context.duration = 0.3;
          clip.animator.boundsOrigin = target;
        }
        completionHandler:^{
          [scroll reflectScrolledClipView:clip];
        }];
    return;
  }
  [clip scrollToPoint:target];
  [_scrollView reflectScrolledClipView:clip];
}

@end
