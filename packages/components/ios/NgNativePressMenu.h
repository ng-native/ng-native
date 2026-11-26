// A menu a press opens on React Native's view. UIKit opens a menu as a primary action only from a
// control of its own, so a clear button with `showsMenuAsPrimaryAction` is laid over the whole view,
// in the view that holds its children and above them. A touch then opens the menu as it goes down,
// as SwiftUI's `Menu` does, and a long press is the menu's too. From iOS 17.4,
// `NgNativeOpenPressMenu` opens it from code: for the app, and for a tap the view took before the
// button was laid.
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
// Whether the menu is showing.
@property (nonatomic, readonly) BOOL showing;

@end

// A press menu button with `entries` laid over `view`, whose choice runs `choose`.
NgNativePressMenuButton *NgNativeAddPressMenu(UIView *view, NSArray *entries, NgNativeMenuChoose choose);

// Open `button`'s menu now, unless it is showing: a touch on the button opens it, and React
// Native's own press on the view can follow. Answers whether it asked UIKit to open it. iOS 17.4 and
// later; does nothing before.
BOOL NgNativeOpenPressMenu(NgNativePressMenuButton *_Nullable button);

NS_ASSUME_NONNULL_END
