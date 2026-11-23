// The AppKit half of scrollers.h: the scroller style the user's "Show scroll bars" setting gives,
// how wide a legacy scroller is, and word when the setting changes.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/scrollers.h"

ngn::ScrollerStyle NGNPreferredScrollerStyle();

// The strip a legacy scroller takes: AppKit's regular one, or its small one for
// `scrollbar-width: thin`.
float NGNLegacyScrollerWidth(BOOL thin);

// Calls `changed` on the main thread each time the preferred scroller style changes, which the
// setting does, and in "Automatically" a mouse plugged in or out. Stops when released.
@interface NGNScrollerStyleObserver : NSObject
- (instancetype)initWithChanged:(void (^)(void))changed;
@end

// Where a trackpad scroll is, as a scroll view's drag and momentum events report it.
typedef NS_ENUM(NSInteger, NGNScrollPhase) {
  NGNScrollPhaseDragBegan,
  NGNScrollPhaseDragEnded,
  NGNScrollPhaseMomentumBegan,
  NGNScrollPhaseMomentumEnded,
};

// A scroll view's NSScrollView, which takes a wheel turn before the view holding it. A turn goes
// past it, up the responder chain, with `scrollingDisabled` (`scrollEnabled={false}`), or when the
// content cannot scroll along the turn's axis: a vertical turn over a horizontal scroll view
// scrolls the one around it. A trackpad gesture is routed once, as it begins, and its momentum
// follows it. A view drawn mirrored (an inverted list's scale of -1) scrolls by mirrored deltas, so
// the content follows the fingers, and the user's scroll direction, as drawn.
@interface NGNWheelScrollView : NSScrollView
@property (nonatomic) BOOL scrollingDisabled;
// `pagingEnabled`: a gesture's end settles on a page, the view's size along the axis.
@property (nonatomic) BOOL pagingEnabled;
// How long a page settling animates, 0.25 s. An animation only runs while the display draws, so a
// test sets 0 to settle at once on a Mac whose screen is locked.
@property (nonatomic) NSTimeInterval settleDuration;
// Called as a trackpad gesture this view scrolls with begins and ends, and as its momentum, or a
// page settling, begins and ends. `velocity` is the drag's at its end, in points a millisecond.
@property (nonatomic, copy) void (^phaseChanged)(NGNScrollPhase phase, NSPoint velocity);
@end

// `event` with its deltas along the axes given turned round.
NSEvent *NGNMirroredScroll(NSEvent *event, BOOL x, BOOL y);
