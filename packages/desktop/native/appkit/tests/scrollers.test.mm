// The AppKit half of the scrollers (scrollers.mm), against offscreen NSScrollViews.
#include "../scrollers.h"

#include <doctest/doctest.h>
#include <objc/runtime.h>

namespace {

NSScrollView *scrollView(NSScrollerStyle style, BOOL thin) {
  NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
  scroll.scrollerStyle = style;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = NO;
  scroll.verticalScroller.controlSize = thin ? NSControlSizeSmall : NSControlSizeRegular;
  scroll.documentView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 900)];
  [scroll tile];
  return scroll;
}

// Runs the main queue long enough for a notification block queued on it.
void drain() {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
}

} // namespace

TEST_CASE("the gutter is the strip a legacy scroller takes from an NSScrollView's content") {
  float regular = NGNLegacyScrollerWidth(NO);
  float thin = NGNLegacyScrollerWidth(YES);
  CHECK(regular > 0);
  CHECK(thin > 0);
  CHECK(thin < regular);
  CHECK(scrollView(NSScrollerStyleLegacy, NO).contentSize.width == doctest::Approx(200 - regular));
  CHECK(scrollView(NSScrollerStyleLegacy, YES).contentSize.width == doctest::Approx(200 - thin));
  // An overlay scroller takes nothing.
  CHECK(scrollView(NSScrollerStyleOverlay, NO).contentSize.width == doctest::Approx(200));
}

TEST_CASE("the preferred style is AppKit's") {
  auto expected = NSScroller.preferredScrollerStyle == NSScrollerStyleLegacy ? ngn::ScrollerStyle::Legacy
                                                                             : ngn::ScrollerStyle::Overlay;
  CHECK(NGNPreferredScrollerStyle() == expected);
}

TEST_CASE("the observer hears the preferred style change, until it is released") {
  __block int changes = 0;
  @autoreleasepool {
    // Precise, so ARC keeps it to the end of this scope, not only to its last use.
    __attribute__((objc_precise_lifetime)) NGNScrollerStyleObserver *observer = [[NGNScrollerStyleObserver alloc] initWithChanged:^{
      changes++;
    }];
    [NSNotificationCenter.defaultCenter postNotificationName:NSPreferredScrollerStyleDidChangeNotification object:nil];
    drain();
    CHECK(changes == 1);
  }
  [NSNotificationCenter.defaultCenter postNotificationName:NSPreferredScrollerStyleDidChangeNotification object:nil];
  drain();
  CHECK(changes == 1);
}

@interface NGNWheelRecorder : NSResponder
@property (nonatomic) int wheels;
@end

@implementation NGNWheelRecorder
- (void)scrollWheel:(NSEvent *)event {
  self.wheels++;
}
@end

TEST_CASE("a scroll view with scrolling disabled lets a wheel turn go past it, and scrolls with it enabled") {
  NGNWheelScrollView *scroll = [[NGNWheelScrollView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
  scroll.hasVerticalScroller = YES;
  NSView *document = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 900)];
  scroll.documentView = document;
  [scroll tile];
  NGNWheelRecorder *above = [NGNWheelRecorder new];
  scroll.nextResponder = above;
  CGEventRef cg = CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitPixel, 1, -60);
  NSEvent *wheel = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  REQUIRE((wheel != nil));

  scroll.scrollingDisabled = YES;
  [document scrollWheel:wheel];
  CHECK(above.wheels == 1);
  CHECK(scroll.contentView.bounds.origin.y == 0);

  // Enabled, the wheel is NSScrollView's own to scroll with. A synthesized wheel moves no
  // offscreen scroll view, so its hand-off to AppKit is counted instead.
  scroll.scrollingDisabled = NO;
  Method method = class_getInstanceMethod(NSScrollView.class, @selector(scrollWheel:));
  IMP original = method_getImplementation(method);
  __block int handled = 0;
  IMP counting = imp_implementationWithBlock(^(NSScrollView *view, NSEvent *event) {
    handled++;
    ((void (*)(id, SEL, NSEvent *))original)(view, @selector(scrollWheel:), event);
  });
  method_setImplementation(method, counting);
  @try {
    [document scrollWheel:wheel];
  } @finally {
    method_setImplementation(method, original);
    imp_removeBlock(counting);
  }
  CHECK(above.wheels == 1);
  CHECK(handled == 1);
}

namespace {

// A trackpad scroll by the fingers' movement, with its gesture phase and momentum phase as CG
// numbers them (kCGScrollPhase*, kCGMomentumScrollPhase*).
NSEvent *trackpad(int32_t dx, int32_t dy, int64_t phase, int64_t momentum = 0) {
  CGEventRef cg = CGEventCreateScrollWheelEvent2(nullptr, kCGScrollEventUnitPixel, 2, dy, dx, 0);
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, 1);
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, phase);
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
  NSEvent *event = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return event;
}

// A scroll view `content` big in a 200 by 300 frame, inside a layer-backed view above it whose
// next responder records the turns that go past.
struct Nested {
  NSView *outer = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
  NGNWheelScrollView *scroll = [[NGNWheelScrollView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
  NSView *document;
  NGNWheelRecorder *above = [NGNWheelRecorder new];
  NSMutableArray<NSEvent *> *handled = [NSMutableArray array];
  NSMutableArray<NSNumber *> *phases = [NSMutableArray array];

  explicit Nested(NSSize content) {
    outer.wantsLayer = YES;
    document = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, content.width, content.height)];
    scroll.documentView = document;
    [outer addSubview:scroll];
    outer.nextResponder = above;
    NSMutableArray<NSNumber *> *seen = phases;
    scroll.phaseChanged = ^(NGNScrollPhase phase, NSPoint) {
      [seen addObject:@(phase)];
    };
  }

  // Sends each event to the document, as AppKit does to the view under the pointer, recording the
  // ones NSScrollView is handed (a synthesized wheel moves no offscreen scroll view).
  void send(NSArray<NSEvent *> *events) {
    Method method = class_getInstanceMethod(NSScrollView.class, @selector(scrollWheel:));
    IMP original = method_getImplementation(method);
    NSMutableArray<NSEvent *> *into = handled;
    IMP recording = imp_implementationWithBlock(^(NSScrollView *view, NSEvent *event) {
      [into addObject:event];
      ((void (*)(id, SEL, NSEvent *))original)(view, @selector(scrollWheel:), event);
    });
    method_setImplementation(method, recording);
    @try {
      for (NSEvent *event in events) {
        [document scrollWheel:event];
      }
    } @finally {
      method_setImplementation(method, original);
      imp_removeBlock(recording);
    }
  }
};

} // namespace

TEST_CASE("a turn along an axis the content does not overflow scrolls the view around it") {
  // A horizontal scroll view: wider content, no taller.
  Nested pager(NSMakeSize(900, 300));
  pager.send(@[ trackpad(0, -40, kCGScrollPhaseBegan), trackpad(-5, -40, kCGScrollPhaseChanged),
                trackpad(0, 0, kCGScrollPhaseEnded), trackpad(0, -30, 0, kCGMomentumScrollPhaseBegin),
                trackpad(0, 0, 0, kCGMomentumScrollPhaseEnd) ]);
  // The whole gesture and its momentum go past, a sideways wobble on the way included.
  CHECK(pager.above.wheels == 5);
  CHECK(pager.handled.count == 0);
  CHECK(pager.phases.count == 0);

  // A sideways gesture is the pager's own, a vertical wobble on the way included.
  pager.send(@[ trackpad(-40, 0, kCGScrollPhaseBegan), trackpad(-40, -45, kCGScrollPhaseChanged),
                trackpad(0, 0, kCGScrollPhaseEnded) ]);
  CHECK(pager.above.wheels == 5);
  CHECK(pager.handled.count == 3);

  // A gesture's start with no deltas waits for the first that has them, and goes the same way.
  pager.send(@[ trackpad(0, 0, kCGScrollPhaseBegan), trackpad(0, -40, kCGScrollPhaseChanged),
                trackpad(0, 0, kCGScrollPhaseEnded) ]);
  CHECK(pager.above.wheels == 8);
  CHECK(pager.handled.count == 3);
  pager.send(@[ trackpad(0, 0, kCGScrollPhaseBegan), trackpad(-40, 0, kCGScrollPhaseChanged) ]);
  CHECK(pager.above.wheels == 8);
  REQUIRE(pager.handled.count == 5);
  CHECK(pager.handled[3].phase == NSEventPhaseBegan);
  pager.above.wheels = 5;
  [pager.handled removeObjectsInRange:NSMakeRange(3, 2)];

  // A mouse's wheel, which has no gesture, goes by each turn.
  pager.send(@[ [NSEvent eventWithCGEvent:CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitLine, 1, -3)] ]);
  CHECK(pager.above.wheels == 6);
}

TEST_CASE("a scroll view drawn upside down scrolls by turned-round deltas, so the content follows the fingers") {
  Nested list(NSMakeSize(200, 900));
  list.outer.layer.transform = CATransform3DMakeScale(1, -1, 1);
  list.send(@[ trackpad(0, -40, kCGScrollPhaseBegan) ]);
  REQUIRE(list.handled.count == 1);
  CHECK(list.handled[0].scrollingDeltaY == 40);
  CHECK(list.handled[0].scrollingDeltaX == 0);

  // A row flipped back inside the inverted list is drawn the right way up again.
  NSView *row = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 300)];
  row.wantsLayer = YES;
  row.layer.transform = CATransform3DMakeScale(1, -1, 1);
  [list.scroll removeFromSuperview];
  [row addSubview:list.scroll];
  [list.outer addSubview:row];
  list.send(@[ trackpad(0, -40, kCGScrollPhaseChanged) ]);
  REQUIRE(list.handled.count == 2);
  CHECK(list.handled[1].scrollingDeltaY == -40);
}

TEST_CASE("a trackpad gesture reports its drag and its momentum") {
  Nested list(NSMakeSize(200, 900));
  list.send(@[ trackpad(0, -10, kCGScrollPhaseBegan), trackpad(0, -40, kCGScrollPhaseChanged),
               trackpad(0, 0, kCGScrollPhaseEnded) ]);
  CHECK([list.phases isEqualToArray:@[ @(NGNScrollPhaseDragBegan), @(NGNScrollPhaseDragEnded) ]]);
  list.send(@[ trackpad(0, -30, 0, kCGMomentumScrollPhaseBegin), trackpad(0, -20, 0, kCGMomentumScrollPhaseContinue),
               trackpad(0, 0, 0, kCGMomentumScrollPhaseEnd) ]);
  CHECK([list.phases isEqualToArray:@[ @(NGNScrollPhaseDragBegan), @(NGNScrollPhaseDragEnded), @(NGNScrollPhaseMomentumBegan),
                                       @(NGNScrollPhaseMomentumEnded) ]]);
}

TEST_CASE("a paged scroll view settles on a page as the gesture ends, and its momentum moves nothing") {
  Nested pager(NSMakeSize(600, 300));
  pager.scroll.pagingEnabled = YES;
  pager.send(@[ trackpad(-10, 0, kCGScrollPhaseBegan), trackpad(-40, 0, kCGScrollPhaseChanged),
                trackpad(0, 0, kCGScrollPhaseEnded), trackpad(-30, 0, 0, kCGMomentumScrollPhaseBegin),
                trackpad(0, 0, 0, kCGMomentumScrollPhaseEnd) ]);
  // The settling is the momentum: the system's own momentum events never reach NSScrollView.
  CHECK(pager.handled.count == 3);
  CHECK(pager.phases.count >= 3);
  CHECK(pager.phases[2].integerValue == NGNScrollPhaseMomentumBegan);
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.5]];
  CHECK(pager.phases.lastObject.integerValue == NGNScrollPhaseMomentumEnded);
}

TEST_CASE("a touch that never moved ends no drag and settles no page") {
  Nested list(NSMakeSize(200, 900));
  list.scroll.pagingEnabled = YES;
  list.send(@[ trackpad(0, 0, kCGScrollPhaseMayBegin), trackpad(0, 0, kCGScrollPhaseEnded) ]);
  CHECK(list.phases.count == 0);
}

TEST_CASE("a drag that begins after a mouse's wheel turned cancels the settling the wheel queued") {
  Nested pager(NSMakeSize(600, 300));
  pager.scroll.pagingEnabled = YES;
  CGEventRef cg = CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitLine, 2, 0, -1);
  NSEvent *wheel = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  pager.send(@[ wheel, trackpad(-10, 0, kCGScrollPhaseBegan), trackpad(-20, 0, kCGScrollPhaseChanged) ]);
  // Past the wheel's wait, with the drag still under way: no settling began.
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.4]];
  CHECK((pager.phases.count == 1));
  CHECK(pager.phases[0].integerValue == NGNScrollPhaseDragBegan);
}

TEST_CASE("a drag whose start has no deltas, after a mouse's wheel turned, cancels the wheel's settling too") {
  Nested pager(NSMakeSize(600, 300));
  pager.scroll.pagingEnabled = YES;
  CGEventRef cg = CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitLine, 2, 0, -1);
  NSEvent *wheel = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  pager.send(@[ wheel, trackpad(0, 0, kCGScrollPhaseBegan) ]);
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.4]];
  pager.send(@[ trackpad(-20, 0, kCGScrollPhaseChanged) ]);
  CHECK((pager.phases.count == 1));
  CHECK(pager.phases[0].integerValue == NGNScrollPhaseDragBegan);
}

