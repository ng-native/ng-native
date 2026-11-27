/**
 The iPad hardware keyboard's focus on React Native's views (NgNativeKeyboardFocus.h).

 - `setFocusable(tag, focusable)`: the view with that react tag commits `focusable`. Sent by
   `@ng-native/components` once the view is committed.

 The first call installs hooks on RCTViewComponentView. A view reported focusable, shown, taking
 touches and not disabled answers `canBecomeFocused`, draws UIKit's focus halo in its corners, and
 while focused takes Space and Return: the press sends the touch start and end a tap at its middle
 would, so whatever presses on a tap (a pressable, its press menu) presses here too. A recycled
 view is forgotten.
 */
#import <React/RCTBridgeModule.h>
#import <React/RCTConversions.h>
#import <React/RCTRootComponentView.h>
#import <React/RCTViewComponentView.h>

#import "NgNativeKeyboardFocus.h"
#import "NgNativeResponderHooks.h"

#include <react/renderer/components/view/TouchEvent.h>

using namespace facebook::react;

// The touch a keyboard press stands for, told apart from a finger's.
static const int kKeyboardTouch = 0x4b4559;

// The view a held Space or Return is pressing, and the key that started it, until that key is let go.
static __weak RCTViewComponentView *pressing;
static UIKeyboardHIDUsage pressingKey;

@interface RCTViewComponentView (NgNativeKeyboardFocus)
- (BOOL)ngn_takesKeyboardFocus;
- (void)ngn_sendKeyboardTouch:(int)phase;
@end

@implementation RCTViewComponentView (NgNativeKeyboardFocus)

- (BOOL)ngn_takesKeyboardFocus
{
  if (!NgNativeKeyboardFocusable(self.tag) || self.hidden || !self.userInteractionEnabled) {
    return NO;
  }
  return !(_props && _props->accessibilityState && _props->accessibilityState->disabled);
}

// 0 starts, 1 ends and 2 cancels the touch, at the view's middle.
- (void)ngn_sendKeyboardTouch:(int)phase
{
  if (!_eventEmitter) {
    return;
  }
  UIView *root = self;
  while (root.superview != nil && ![root isKindOfClass:[RCTRootComponentView class]]) {
    root = root.superview;
  }
  CGPoint middle = CGPointMake(CGRectGetMidX(self.bounds), CGRectGetMidY(self.bounds));
  Touch touch{};
  touch.offsetPoint = RCTPointFromCGPoint(middle);
  touch.pagePoint = RCTPointFromCGPoint([self convertPoint:middle toView:root]);
  touch.screenPoint = RCTPointFromCGPoint([self convertPoint:middle toView:nil]);
  touch.identifier = kKeyboardTouch;
  touch.target = (Tag)self.tag;
  NSTimeInterval now = CACurrentMediaTime();
  touch.timestamp = (Float)now;
  touch.timeStamp = RCTHighResTimeStampFromSeconds(now);
  TouchEvent event;
  event.changedTouches.insert(touch);
  if (phase == 0) {
    event.touches.insert(touch);
    event.targetTouches.insert(touch);
    _eventEmitter->onTouchStart(event);
  } else if (phase == 1) {
    _eventEmitter->onTouchEnd(event);
  } else {
    _eventEmitter->onTouchCancel(event);
  }
}

@end

// The key among `presses` that presses the focused view, or 0 for none.
static UIKeyboardHIDUsage keyPressingView(NSSet<UIPress *> *presses)
{
  for (UIPress *press in presses) {
    if (press.key != nil && NgNativeKeyPresses(press.key.keyCode, press.key.modifierFlags)) {
      return press.key.keyCode;
    }
  }
  return (UIKeyboardHIDUsage)0;
}

// Whether `presses` let go of `key`, whatever is held with it now.
static BOOL releases(NSSet<UIPress *> *presses, UIKeyboardHIDUsage key)
{
  for (UIPress *press in presses) {
    if (press.key != nil && press.key.keyCode == key) {
      return YES;
    }
  }
  return NO;
}

static void installHooks(void)
{
  Class view = [RCTViewComponentView class];
  NgNativeHook(view, @selector(canBecomeFocused), "B@:", ^id(IMP previous) {
    return ^BOOL(RCTViewComponentView *self) {
      if ([self ngn_takesKeyboardFocus]) {
        return YES;
      }
      return previous != NULL && ((BOOL (*)(id, SEL))previous)(self, @selector(canBecomeFocused));
    };
  });
  NgNativeHook(view, @selector(focusEffect), "@@:", ^id(IMP previous) {
    return ^UIFocusEffect *(RCTViewComponentView *self) {
      if ([self ngn_takesKeyboardFocus]) {
        return [UIFocusHaloEffect effectWithRoundedRect:self.bounds
                                           cornerRadius:self.layer.cornerRadius
                                                  curve:kCACornerCurveContinuous];
      }
      return previous != NULL ? ((UIFocusEffect * (*)(id, SEL)) previous)(self, @selector(focusEffect)) : nil;
    };
  });
  NgNativeHook(view, @selector(pressesBegan:withEvent:), "v@:@@", ^id(IMP previous) {
    return ^(RCTViewComponentView *self, NSSet<UIPress *> *presses, UIPressesEvent *event) {
      UIKeyboardHIDUsage key = keyPressingView(presses);
      if (pressing == nil && key != (UIKeyboardHIDUsage)0 && self.isFocused && [self ngn_takesKeyboardFocus]) {
        pressing = self;
        pressingKey = key;
        [self ngn_sendKeyboardTouch:0];
        return;
      }
      if (previous != NULL) {
        ((void (*)(id, SEL, id, id))previous)(self, @selector(pressesBegan:withEvent:), presses, event);
      }
    };
  });
  NgNativeHook(view, @selector(pressesEnded:withEvent:), "v@:@@", ^id(IMP previous) {
    return ^(RCTViewComponentView *self, NSSet<UIPress *> *presses, UIPressesEvent *event) {
      // Only the key that started the press ends it: another one let go while it is held does not.
      if (pressing == self && releases(presses, pressingKey)) {
        pressing = nil;
        [self ngn_sendKeyboardTouch:1];
        return;
      }
      if (previous != NULL) {
        ((void (*)(id, SEL, id, id))previous)(self, @selector(pressesEnded:withEvent:), presses, event);
      }
    };
  });
  NgNativeHook(view, @selector(pressesCancelled:withEvent:), "v@:@@", ^id(IMP previous) {
    return ^(RCTViewComponentView *self, NSSet<UIPress *> *presses, UIPressesEvent *event) {
      if (pressing == self && releases(presses, pressingKey)) {
        pressing = nil;
        [self ngn_sendKeyboardTouch:2];
        return;
      }
      if (previous != NULL) {
        ((void (*)(id, SEL, id, id))previous)(self, @selector(pressesCancelled:withEvent:), presses, event);
      }
    };
  });
  NgNativeHook(view, @selector(prepareForRecycle), "v@:", ^id(IMP previous) {
    return ^(RCTViewComponentView *self) {
      NgNativeSetKeyboardFocusable(self.tag, NO);
      if (pressing == self) {
        pressing = nil;
      }
      if (previous != NULL) {
        ((void (*)(id, SEL))previous)(self, @selector(prepareForRecycle));
      }
    };
  });
}

@interface NgNativeKeyboardFocus : NSObject <RCTBridgeModule>
@end

@implementation NgNativeKeyboardFocus

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(setFocusable : (double)tag focusable : (BOOL)focusable)
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    installHooks();
  });
  NgNativeSetKeyboardFocusable((NSInteger)tag, focusable);
}

@end
