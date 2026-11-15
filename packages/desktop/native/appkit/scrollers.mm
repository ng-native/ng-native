#import "scrollers.h"

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
