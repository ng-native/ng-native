// A menu a press opens on React Native's view. UIKit opens a menu on a touch only from a control
// of its own, so a clear button with `showsMenuAsPrimaryAction` is laid over the whole view, in the
// view that holds its children and above them. A touch then opens the menu, and VoiceOver's
// activation of the view, which taps its middle, opens it too. UIKit has no way to open it from
// code.
#pragma once

#import <UIKit/UIKit.h>

#import "NgNativeMenuBuilding.h"

NS_ASSUME_NONNULL_BEGIN

@interface NgNativePressMenuButton : UIButton

- (instancetype)initWithChoose:(NgNativeMenuChoose)choose;
- (instancetype)initWithFrame:(CGRect)frame NS_UNAVAILABLE;
- (instancetype)initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

// The menu, as the app sends it; setting it makes the button's menu again.
@property (nonatomic, copy) NSArray *entries;

@end

// A press menu button with `entries` laid over `view`, whose choice runs `choose`.
NgNativePressMenuButton *NgNativeAddPressMenu(UIView *view, NSArray *entries, NgNativeMenuChoose choose);

NS_ASSUME_NONNULL_END
