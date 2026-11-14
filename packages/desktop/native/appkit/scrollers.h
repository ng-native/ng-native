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
