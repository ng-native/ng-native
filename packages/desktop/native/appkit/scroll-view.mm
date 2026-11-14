#import "scroll-view.h"

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
  NSScrollView *_scrollView;
  NGNScrollDocumentView *_document;
  State::Shared _scrollState;
  BOOL _applyingState;
  BOOL _showsVertical;
  BOOL _showsHorizontal;
}

+ (std::function<void(NSInteger, CGPoint)>)offsetChanged {
  return gOffsetChanged;
}

+ (void)setOffsetChanged:(std::function<void(NSInteger, CGPoint)>)offsetChanged {
  gOffsetChanged = std::move(offsetChanged);
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _scrollView = [[NSScrollView alloc] initWithFrame:NSZeroRect];
    _scrollView.drawsBackground = NO;
    _scrollView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _scrollView.autohidesScrollers = YES;
    // Overlay scrollers whatever the system setting: React Native lays the content out at the
    // scroll view's full width, which a legacy scroller would take a strip of.
    _scrollView.scrollerStyle = NSScrollerStyleOverlay;
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
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
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
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  _scrollView.frame = self.bounds;
  [self updateScrollers];
}

// A scroller only along an axis the content overflows.
- (void)updateScrollers {
  NSSize content = _document.frame.size, view = self.bounds.size;
  _scrollView.hasVerticalScroller = _showsVertical && content.height > view.height + 0.5;
  _scrollView.hasHorizontalScroller = _showsHorizontal && content.width > view.width + 0.5;
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
}

- (void)scrollWheel:(NSEvent *)event {
  auto p = std::dynamic_pointer_cast<const ScrollViewProps>(self.props);
  if (p && !p->scrollEnabled) {
    [self.nextResponder scrollWheel:event];
    return;
  }
  [_scrollView scrollWheel:event];
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
    ScrollEvent event;
    event.contentOffset = {static_cast<Float>(origin.x), static_cast<Float>(origin.y)};
    event.contentSize = {static_cast<Float>(_document.frame.size.width), static_cast<Float>(_document.frame.size.height)};
    event.containerSize = {static_cast<Float>(self.bounds.size.width), static_cast<Float>(self.bounds.size.height)};
    event.zoomScale = 1;
    event.timestamp = NSProcessInfo.processInfo.systemUptime;
    emitter->onScroll(event);
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
  [clip scrollToPoint:target];
  [_scrollView reflectScrolledClipView:clip];
}

@end
