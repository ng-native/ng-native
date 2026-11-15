// The AppKit half of the scrollers (scrollers.mm), against offscreen NSScrollViews.
#include "../scrollers.h"

#include <doctest/doctest.h>

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

  scroll.scrollingDisabled = NO;
  [document scrollWheel:wheel];
  CHECK(above.wheels == 1);
}
