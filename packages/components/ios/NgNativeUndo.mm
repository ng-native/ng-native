#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <UIKit/UIKit.h>

#import "NgNativeResponderHooks.h"

/**
 The `NgNativeUndo` module on iOS (`NativeUndo` in @ng-native/device), over one NSUndoManager that
 every window answers as its `undoManager`: shake to undo, mod+z and mod+shift+z from a hardware
 keyboard, and Edit > Undo and Redo on an iPad reach the app's actions while no text input takes
 them first.
 - `register(id, label)` registers an action named `label`. Undoing it sends
   `{ type: 'undo', id }` on `ngNativeUndo` and registers its redo under the same id; redoing sends
   `{ type: 'redo', id }`.
 - `undo()`, `redo()` and `clear()` are Edit > Undo, Edit > Redo and removing every action.
 */
@interface NgNativeUndo : NSObject <RCTBridgeModule, RCTInvalidating, NgNativeUndoHost>
@end

@implementation NgNativeUndo {
  NSUndoManager *_manager;
}

@synthesize callableJSModules = _callableJSModules;

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    _manager = [NSUndoManager new];
    dispatch_async(dispatch_get_main_queue(), ^{
      NgNativeInstallResponderHooks();
      NgNativeSetUndoHost(self);
    });
  }
  return self;
}

- (void)invalidate
{
  // A reload starts the history again; the app that registered it is gone.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_manager removeAllActions];
  });
}

- (NSUndoManager *)sharedUndoManager
{
  return _manager;
}

- (void)send:(NSString *)type itemId:(NSString *)itemId
{
  [_callableJSModules invokeModule:@"RCTDeviceEventEmitter"
                            method:@"emit"
                          withArgs:@[ @"ngNativeUndo", @{@"type" : type, @"id" : itemId} ]];
}

// One step: undoing it sends `undo` and registers the redo, which sends `redo` and registers the
// undo again. NSUndoManager puts a registration made while undoing on the redo stack.
- (void)registerStep:(NSString *)itemId label:(NSString *)label
{
  [_manager registerUndoWithTarget:self
                           handler:^(NgNativeUndo *target) {
                             NSString *type = target->_manager.isUndoing ? @"undo" : @"redo";
                             [target send:type itemId:itemId];
                             [target registerStep:itemId label:label];
                           }];
  [_manager setActionName:label];
}

RCT_EXPORT_METHOD(register : (NSString *)itemId label : (NSString *)label)
{
  [self registerStep:itemId label:label ?: @""];
}

RCT_EXPORT_METHOD(undo)
{
  if (_manager.canUndo) {
    [_manager undo];
  }
}

RCT_EXPORT_METHOD(redo)
{
  if (_manager.canRedo) {
    [_manager redo];
  }
}

RCT_EXPORT_METHOD(clear)
{
  [_manager removeAllActions];
}

@end
