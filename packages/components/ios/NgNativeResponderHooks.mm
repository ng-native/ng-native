#import "NgNativeResponderHooks.h"

#import <objc/runtime.h>

// Edit > Undo and Redo's actions, which UIKit's menus name and no public header declares.
@protocol NgNativeUndoActions
- (void)undo:(id)sender;
- (void)redo:(id)sender;
@end

static __weak id<NgNativeMenusHost> menusHost;
static __weak id<NgNativeUndoHost> undoHost;

void NgNativeSetMenusHost(id<NgNativeMenusHost> host)
{
  menusHost = host;
}

void NgNativeSetUndoHost(id<NgNativeUndoHost> host)
{
  undoHost = host;
}

/** The first responder, which answers `ngn_reportFirstResponder:` sent to no one in particular. */
static __weak UIResponder *reported;

@interface UIResponder (NgNativeFirstResponder)
- (void)ngn_reportFirstResponder:(id)sender;
@end

@implementation UIResponder (NgNativeFirstResponder)

- (void)ngn_reportFirstResponder:(id)sender
{
  reported = self;
}

@end

static UIResponder *firstResponder(void)
{
  reported = nil;
  [UIApplication.sharedApplication sendAction:@selector(ngn_reportFirstResponder:) to:nil from:nil forEvent:nil];
  UIResponder *found = reported;
  reported = nil;
  return found;
}

BOOL NgNativeTextInputFocused(void)
{
  return [firstResponder() conformsToProtocol:@protocol(UITextInput)];
}

static UIWindow *keyWindow(void)
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]]) {
      for (UIWindow *window in ((UIWindowScene *)scene).windows) {
        if (window.isKeyWindow) {
          return window;
        }
      }
    }
  }
  return nil;
}

/**
 Replaces `selector` on `cls` with what `make` answers, which receives the implementation it
 replaces to call: the class's own, the one it inherited, or NULL where it had none, and `types`
 is the method's type encoding then. A method the class only inherited is added to the class, so
 its superclass is untouched.
 */
static void hook(Class cls, SEL selector, const char *types, id (^make)(IMP _Nullable previous))
{
  Method method = class_getInstanceMethod(cls, selector);
  IMP previous = method != NULL ? method_getImplementation(method) : NULL;
  IMP replacement = imp_implementationWithBlock(make(previous));
  const char *encoding = method != NULL ? method_getTypeEncoding(method) : types;
  if (!class_addMethod(cls, selector, replacement, encoding)) {
    method_setImplementation(method, replacement);
  }
}

@implementation UIApplication (NgNative)

- (void)ngn_menuBarItem:(UICommand *)command
{
  [menusHost commandChosen:command shortcut:NO];
}

- (void)ngn_shortcut:(UIKeyCommand *)command
{
  [menusHost commandChosen:command shortcut:YES];
}

@end

/** The app delegate's hooks: the shortcuts' key commands, and the app's groups in the menu bar. */
static void hookAppDelegate(Class delegate)
{
  hook(delegate, @selector(keyCommands), "@@:", ^id(IMP previous) {
    return ^NSArray<UIKeyCommand *> *(UIResponder *self) {
      NSArray<UIKeyCommand *> *own =
          previous != NULL ? ((NSArray * (*)(id, SEL)) previous)(self, @selector(keyCommands)) : nil;
      NSArray<UIKeyCommand *> *shortcuts = [menusHost shortcutKeyCommands];
      if (shortcuts.count == 0) {
        return own;
      }
      return own.count > 0 ? [own arrayByAddingObjectsFromArray:shortcuts] : shortcuts;
    };
  });

  hook(delegate, @selector(buildMenuWithBuilder:), "v@:@", ^id(IMP previous) {
    return ^(UIResponder *self, id<UIMenuBuilder> builder) {
      if (previous != NULL) {
        ((void (*)(id, SEL, id))previous)(self, @selector(buildMenuWithBuilder:), builder);
      }
      [menusHost buildMenuBar:builder];
    };
  });
}

/**
 Undo or Redo on UIApplication, at the end of the responder chain, while the undo module is there:
 the key window's undo manager's, which is the app's, or a focused text input's own. Without the
 module, what UIApplication did before, if anything.
 */
static void hookUndoAction(SEL selector, BOOL redo)
{
  hook([UIApplication class], selector, "v@:@", ^id(IMP previous) {
    return ^(UIResponder *self, id sender) {
      if ([undoHost sharedUndoManager] == nil) {
        if (previous != NULL) {
          ((void (*)(id, SEL, id))previous)(self, selector, sender);
        }
        return;
      }
      NSUndoManager *manager = keyWindow().undoManager;
      if (redo ? manager.canRedo : manager.canUndo) {
        redo ? [manager redo] : [manager undo];
      }
    };
  });
}

void NgNativeInstallResponderHooks(void)
{
  static BOOL delegateHooked = NO;
  if (!delegateHooked) {
    Class delegate = [UIApplication.sharedApplication.delegate class];
    if (delegate != nil && [delegate isSubclassOfClass:[UIResponder class]]) {
      hookAppDelegate(delegate);
      delegateHooked = YES;
    }
  }

  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method undoBefore = class_getInstanceMethod([UIApplication class], @selector(undo:));
    BOOL hadUndo = undoBefore != NULL;
    hookUndoAction(@selector(undo:), NO);
    hookUndoAction(@selector(redo:), YES);

    // Undo and Redo named for the action, and disabled with none, or with no module to undo when
    // UIApplication had no Undo of its own.
    hook([UIApplication class], @selector(validateCommand:), "v@:@", ^id(IMP previous) {
      return ^(UIResponder *self, UICommand *command) {
        if (previous != NULL) {
          ((void (*)(id, SEL, id))previous)(self, @selector(validateCommand:), command);
        }
        BOOL undo = command.action == @selector(undo:);
        if (!undo && command.action != @selector(redo:)) {
          return;
        }
        if ([undoHost sharedUndoManager] == nil) {
          if (!hadUndo) {
            command.attributes |= UIMenuElementAttributesDisabled;
          }
          return;
        }
        NSUndoManager *manager = keyWindow().undoManager;
        command.title = undo ? manager.undoMenuItemTitle : manager.redoMenuItemTitle;
        BOOL can = undo ? manager.canUndo : manager.canRedo;
        command.attributes = can ? (command.attributes & ~UIMenuElementAttributesDisabled)
                                 : (command.attributes | UIMenuElementAttributesDisabled);
      };
    });

    // Undo and Redo outside a text input: shake to undo, mod+z, and Edit > Undo on an iPad all
    // reach the window's undo manager, which is then the one the app's actions are in. While a
    // text input has focus the window answers its own, so typing keeps a history of its own, as
    // on macOS. Without the module, each window has its own again.
    hook([UIWindow class], @selector(undoManager), "@@:", ^id(IMP previous) {
      return ^NSUndoManager *(UIWindow *self) {
        NSUndoManager *shared = [undoHost sharedUndoManager];
        if (shared != nil && !NgNativeTextInputFocused()) {
          return shared;
        }
        return previous != NULL ? ((NSUndoManager * (*)(id, SEL)) previous)(self, @selector(undoManager)) : nil;
      };
    });
  });
}
