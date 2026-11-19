#import "scrollers.h"

#import <QuartzCore/QuartzCore.h>

#include <algorithm>
#include <cmath>

ngn::ScrollerStyle NGNPreferredScrollerStyle() {
  return NSScroller.preferredScrollerStyle == NSScrollerStyleLegacy ? ngn::ScrollerStyle::Legacy
                                                                    : ngn::ScrollerStyle::Overlay;
}

float NGNLegacyScrollerWidth(BOOL thin) {
  return static_cast<float>([NSScroller scrollerWidthForControlSize:thin ? NSControlSizeSmall : NSControlSizeRegular
                                                      scrollerStyle:NSScrollerStyleLegacy]);
}

@implementation NGNScrollerStyleObserver {
  id<NSObject> _token;
}

- (instancetype)initWithChanged:(void (^)(void))changed {
  if ((self = [super init])) {
    _token = [NSNotificationCenter.defaultCenter addObserverForName:NSPreferredScrollerStyleDidChangeNotification
                                                             object:nil
                                                              queue:NSOperationQueue.mainQueue
                                                         usingBlock:^(NSNotification *) {
                                                           changed();
                                                         }];
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:_token];
}

@end

NSEvent *NGNMirroredScroll(NSEvent *event, BOOL x, BOOL y) {
  if ((!x && !y) || event.CGEvent == nullptr) {
    return event;
  }
  CGEventRef cg = CGEventCreateCopy(event.CGEvent);
  // Setting the lines recomputes the other two from them, so all three are read first and set in
  // this order. The points are read as a double, which keeps a trackpad's fractions.
  auto negate = [cg](CGEventField lines, CGEventField fixed, CGEventField points) {
    int64_t l = CGEventGetIntegerValueField(cg, lines);
    double f = CGEventGetDoubleValueField(cg, fixed), p = CGEventGetDoubleValueField(cg, points);
    CGEventSetIntegerValueField(cg, lines, -l);
    CGEventSetDoubleValueField(cg, fixed, -f);
    CGEventSetDoubleValueField(cg, points, -p);
  };
  if (y) {
    negate(kCGScrollWheelEventDeltaAxis1, kCGScrollWheelEventFixedPtDeltaAxis1, kCGScrollWheelEventPointDeltaAxis1);
  }
  if (x) {
    negate(kCGScrollWheelEventDeltaAxis2, kCGScrollWheelEventFixedPtDeltaAxis2, kCGScrollWheelEventPointDeltaAxis2);
  }
  NSEvent *mirrored = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return mirrored != nil ? mirrored : event;
}

@implementation NGNWheelScrollView {
  // The gesture under way goes up the responder chain: it began along an axis this view cannot
  // scroll along.
  BOOL _passing;
  // A gesture's start with no deltas yet, held until an event says which axis it goes along.
  NSEvent *_heldStart;
  // The gesture under way ended in a page settling, so its momentum moves nothing.
  BOOL _settling;
  // A drag has begun and not yet ended: an end with no beginning (a touch that never moved) reports
  // nothing and settles nothing.
  BOOL _dragging;
  NSPoint _velocity;
  NSTimeInterval _lastWheel;
  // When the deltas last moved: a drag held still before it ends was not flicked.
  NSTimeInterval _lastMove;
  // Moved on by each page settling, so only the latest one's end is reported.
  uint64_t _settle;
  BOOL _settleUnderway;
}

- (void)setPagingEnabled:(BOOL)pagingEnabled {
  _pagingEnabled = pagingEnabled;
  if (!pagingEnabled) {
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settleOnPage) object:nil];
  }
}

// Whether the content overflows the view along the axis the deltas mostly go along.
- (BOOL)scrollsAlong:(NSEvent *)event {
  NSSize content = self.documentView.frame.size, view = self.contentView.bounds.size;
  if (std::fabs(event.scrollingDeltaX) > std::fabs(event.scrollingDeltaY)) {
    return content.width > view.width + 0.5;
  }
  return content.height > view.height + 0.5;
}

// Whether the view is drawn mirrored along each axis: an odd number of the layers above it scaled
// by a negative amount along it.
- (void)mirroredX:(BOOL *)x y:(BOOL *)y {
  *x = NO;
  *y = NO;
  for (NSView *view = self; view != nil; view = view.superview) {
    CATransform3D t = view.layer.transform;
    *x ^= t.m11 < 0;
    *y ^= t.m22 < 0;
  }
}

- (void)scrollWheel:(NSEvent *)event {
  if (self.scrollingDisabled) {
    [self.nextResponder scrollWheel:event];
    return;
  }
  NSEventPhase phase = event.phase, momentum = event.momentumPhase;
  BOOL wheel = phase == NSEventPhaseNone && momentum == NSEventPhaseNone;
  BOOL still = event.scrollingDeltaX == 0 && event.scrollingDeltaY == 0;
  if (phase == NSEventPhaseBegan) {
    // A mouse's wheel may have queued a settling: the gesture now beginning has its own.
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settleOnPage) object:nil];
  }
  if (phase == NSEventPhaseMayBegin) {
    _passing = NO;
    _heldStart = nil;
  } else if (phase == NSEventPhaseBegan && still) {
    _heldStart = event;
    _passing = NO;
    return;
  } else if (phase == NSEventPhaseBegan || wheel || (_heldStart != nil && !still)) {
    _passing = ![self scrollsAlong:event];
    _settling = NO;
  }
  if (_heldStart != nil && (!still || (phase != NSEventPhaseChanged && phase != NSEventPhaseStationary))) {
    NSEvent *start = _heldStart;
    _heldStart = nil;
    [self scrollDecided:start];
  }
  [self scrollDecided:event];
}

// An event of a gesture whose route is decided.
- (void)scrollDecided:(NSEvent *)event {
  NSEventPhase phase = event.phase, momentum = event.momentumPhase;
  BOOL wheel = phase == NSEventPhaseNone && momentum == NSEventPhaseNone;
  if (_passing) {
    [self.nextResponder scrollWheel:event];
    return;
  }
  BOOL x, y;
  [self mirroredX:&x y:&y];
  NSEvent *scroll = NGNMirroredScroll(event, x, y);
  if (momentum != NSEventPhaseNone && _settling) {
    if (momentum == NSEventPhaseEnded || momentum == NSEventPhaseCancelled) {
      _settling = NO;
    }
    return;
  }
  if (phase == NSEventPhaseBegan || phase == NSEventPhaseChanged || wheel) {
    NSTimeInterval elapsed = std::max(scroll.timestamp - _lastWheel, 0.001);
    _lastWheel = scroll.timestamp;
    if (scroll.scrollingDeltaX != 0 || scroll.scrollingDeltaY != 0) {
      // AppKit's deltas move the content; the offset goes the other way. A mouse's are in lines.
      CGFloat across = scroll.hasPreciseScrollingDeltas ? 1 : self.horizontalLineScroll;
      CGFloat down = scroll.hasPreciseScrollingDeltas ? 1 : self.verticalLineScroll;
      _velocity = NSMakePoint(-scroll.scrollingDeltaX * across / (elapsed * 1000),
                              -scroll.scrollingDeltaY * down / (elapsed * 1000));
      _lastMove = scroll.timestamp;
    }
  }
  [super scrollWheel:scroll];
  if (phase == NSEventPhaseBegan) {
    _velocity = NSZeroPoint;
    _dragging = YES;
    [self report:NGNScrollPhaseDragBegan];
  } else if ((phase == NSEventPhaseEnded || phase == NSEventPhaseCancelled) && _dragging) {
    _dragging = NO;
    // ponytail: a tenth of a second held still is no flick; tune here if it feels off.
    if (scroll.timestamp - _lastMove > 0.1) {
      _velocity = NSZeroPoint;
    }
    [self report:NGNScrollPhaseDragEnded];
    if (self.pagingEnabled) {
      _settling = YES;
      [self settleOnPage];
    }
  } else if (momentum == NSEventPhaseBegan) {
    [self report:NGNScrollPhaseMomentumBegan];
  } else if (momentum == NSEventPhaseEnded || momentum == NSEventPhaseCancelled) {
    [self report:NGNScrollPhaseMomentumEnded];
  } else if (wheel && self.pagingEnabled) {
    // A mouse's wheel has no end: the page settles once it stops turning.
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settleOnPage) object:nil];
    [self performSelector:@selector(settleOnPage) withObject:nil afterDelay:0.2];
  }
}

- (void)report:(NGNScrollPhase)phase {
  if (self.phaseChanged) {
    self.phaseChanged(phase, _velocity);
  }
}

// Animates to the page the drag points at (ngn::pagedOffset), reporting it as momentum.
- (void)settleOnPage {
  if (!self.pagingEnabled) {
    return;
  }
  NSClipView *clip = self.contentView;
  NSSize content = self.documentView.frame.size, view = clip.bounds.size;
  NSPoint from = clip.bounds.origin;
  NSPoint to = NSMakePoint(
      ngn::pagedOffset(from.x, _velocity.x, view.width, content.width - view.width),
      ngn::pagedOffset(from.y, _velocity.y, view.height, content.height - view.height));
  _velocity = NSZeroPoint;
  // One settling in front of another ends the first before the second begins.
  if (_settleUnderway) {
    [self report:NGNScrollPhaseMomentumEnded];
  }
  uint64_t settle = ++_settle;
  _settleUnderway = YES;
  [self report:NGNScrollPhaseMomentumBegan];
  __weak NGNWheelScrollView *weakSelf = self;
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.25;
        context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
        clip.animator.boundsOrigin = to;
      }
      completionHandler:^{
        NGNWheelScrollView *strong = weakSelf;
        if (strong == nil || strong->_settle != settle) {
          return;
        }
        strong->_settleUnderway = NO;
        [strong reflectScrolledClipView:clip];
        [strong report:NGNScrollPhaseMomentumEnded];
      }];
}

@end
