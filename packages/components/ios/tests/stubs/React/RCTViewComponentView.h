// What the unit tests compile the iOS sources against in place of React Native's header, which
// needs React Native's C++: React Native's view as the binder and the hooks see it, a UIView with
// the `nativeID` the app gave it. The tests define it.
#pragma once

#import <UIKit/UIKit.h>

@interface RCTViewComponentView : UIView
@property (nonatomic, copy, nullable) NSString *nativeId;
@end
