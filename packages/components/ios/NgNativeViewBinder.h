// React Native's views found by `nativeID`, for a module that adds a UIKit interaction to a view
// it does not own: a context menu, a drop or a drag. The directive names the view; the binder finds
// it once it is mounted and lets it go as it is unmounted, recycled for another element, or given
// another `nativeID`. React Native's view is never replaced or subclassed. A legacy module is
// handed no surface presenter in bridgeless mode, so the binder follows mounts by checking its
// views each time the main run loop finishes its work, while it has any.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Called with the view found for `nativeID`; what it answers is handed back to `detach`.
typedef id _Nullable (^NgNativeViewAttach)(UIView *view, NSString *nativeID);
typedef void (^NgNativeViewDetach)(UIView *view, id token);

@interface NgNativeViewBinder : NSObject

- (instancetype)initWithAttach:(NgNativeViewAttach)attach detach:(NgNativeViewDetach)detach;
- (instancetype)init NS_UNAVAILABLE;

// Keep the view with `nativeID` attached, once it is mounted. Main thread.
- (void)bind:(NSString *)nativeID;
// Detach the view with `nativeID`, and stop looking for it. Main thread.
- (void)unbind:(NSString *)nativeID;
// Detach every view. Main thread.
- (void)unbindAll;
// Check each view still is the one with its `nativeID`, and look for the ones not found yet. Main
// thread.
- (void)refresh;

@end

NS_ASSUME_NONNULL_END
