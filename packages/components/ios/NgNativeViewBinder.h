// React Native's views found by `nativeID`, for a module that adds a UIKit interaction to a view
// it does not own: a context menu, a drop or a drag. The directive names the view; the binder finds
// it once it is mounted and lets it go as it is unmounted, recycled for another element, or given
// another `nativeID`. React Native's view is never replaced or subclassed. A legacy module is
// handed no surface presenter in bridgeless mode, so the binder follows mounts by checking its
// views each time the main run loop finishes its work, while it has any. A view not found is looked
// for again at once after a bind or a detach, and then less and less often while it stays missing
// (a screen mounted but not in a window), up to every two seconds.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Called with the view found for `nativeID`; what it answers is handed back to `detach`.
typedef id _Nullable (^NgNativeViewAttach)(UIView *view, NSString *nativeID);
typedef void (^NgNativeViewDetach)(UIView *view, id token);

@interface NgNativeViewBinder : NSObject

- (instancetype)initWithAttach:(NgNativeViewAttach)attach detach:(NgNativeViewDetach)detach;
- (instancetype)init NS_UNAVAILABLE;

// The views searched for a missing `nativeID`: every window of every connected scene, unless set.
@property (nonatomic, copy, null_resettable) NSArray<UIView *> * (^roots)(void);
// How long the binder now waits between searches for a view it has not found, in seconds.
@property (nonatomic, readonly) NSTimeInterval searchInterval;
// How many searches it has made.
@property (nonatomic, readonly) NSUInteger searches;

// Keep the view with `nativeID` attached, once it is mounted. Main thread.
- (void)bind:(NSString *)nativeID;
// Detach the view with `nativeID`, and stop looking for it. Main thread.
- (void)unbind:(NSString *)nativeID;
// What attaching the view now bound to `nativeID` answered, or nil while none is: each attach
// answers its own, so a caller can tell the binding it started with from a later one of the same
// name. Main thread.
- (nullable id)tokenFor:(NSString *)nativeID;
// What attaching the view bound to `nativeID` answered, looking for that view now if it has not
// been found, however long the binder would otherwise wait: for a view the user has just touched,
// which is mounted and in a window. Nil when `nativeID` is not bound, or no view has it. Main
// thread.
- (nullable id)tokenFindingNow:(NSString *)nativeID;
// Detach every view. Main thread.
- (void)unbindAll;
// Check each view still is the one with its `nativeID`, and look for the ones not found yet. Main
// thread.
- (void)refresh;

@end

// The `nativeID` React Native's view has, or nil for any other view.
NSString *_Nullable NgNativeNativeIdOf(UIView *view);

// Whether a long press on `touched` is taken by a view on its way up to `menuView` (not
// `menuView` itself) whose `nativeID` is in `takers`: one with its own `(longPress)`.
BOOL NgNativeLongPressTaken(UIView *_Nullable touched, UIView *menuView, NSSet<NSString *> *takers);

NS_ASSUME_NONNULL_END
