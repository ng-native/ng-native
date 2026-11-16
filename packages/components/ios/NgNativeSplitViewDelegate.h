// The delegate of `<split-view>`'s UISplitViewController on an iPad, apart from the component view
// so the unit tests reach it without React Native: which column a collapse leaves on top, which
// display mode an expansion goes back to, and which display mode changes are the user's.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NgNativeSplitViewDelegate : NSObject <UISplitViewControllerDelegate>

// Called when the user shuts (YES) or opens (NO) the sidebar, with its button or a swipe.
@property (nonatomic, copy, nullable) void (^onCollapse)(BOOL collapsed);

- (instancetype)initWithController:(UISplitViewController *)controller NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

// The app's `collapsed`: hides or shows the primary column, and is kept as the size changes.
- (void)setCollapsed:(BOOL)collapsed;
// The `showContent` and `showSidebar` commands.
- (void)showContent;
- (void)showSidebar;
// A column was laid out: the controller's size is settled, so a display mode change at that width
// and size class is the user's, and one at another is UIKit fitting the columns to a new size.
- (void)columnLaidOut;

@end

NS_ASSUME_NONNULL_END
