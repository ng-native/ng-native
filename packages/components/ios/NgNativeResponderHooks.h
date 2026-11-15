// What the app delegate and UIApplication answer in the responder chain on iOS: the key commands
// for the app's shortcuts (NgNativeMenus), the iPad menu bar through UIMenuBuilder, and the Undo
// and Redo commands for the shared undo manager (NgNativeUndo). The app delegate is Expo's and
// UIApplication is UIKit's, so the hooks are added to their classes at run time. Each calls what
// the class had before (its own method or the one it inherited), and does only that while no
// module is there to answer.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol NgNativeMenusHost <NSObject>
// The key commands for every shortcut outside the menu bar.
- (NSArray<UIKeyCommand *> *)shortcutKeyCommands;
// Adds the app's groups to the main menu.
- (void)buildMenuBar:(id<UIMenuBuilder>)builder;
// A menu bar item or a shortcut was chosen: the command's `propertyList` is its id.
- (void)commandChosen:(UICommand *)command shortcut:(BOOL)shortcut;
@end

@protocol NgNativeUndoHost <NSObject>
- (NSUndoManager *)sharedUndoManager;
@end

// The actions of the app's menu bar items and shortcuts, which UIApplication answers at the end of
// the responder chain.
@interface UIApplication (NgNative)
- (void)ngn_menuBarItem:(UICommand *)command;
- (void)ngn_shortcut:(UIKeyCommand *)command;
@end

// Install the hooks, once, on the main thread. Each forwards to the host while it is set. The app
// delegate's are installed once there is an app delegate, so a call before then tries again.
void NgNativeInstallResponderHooks(void);
void NgNativeSetMenusHost(id<NgNativeMenusHost> _Nullable host);
void NgNativeSetUndoHost(id<NgNativeUndoHost> _Nullable host);

// Whether the first responder in the key window edits text.
BOOL NgNativeTextInputFocused(void);

// Whether a window answers the app's shared undo manager while `firstResponder` is first: with
// none, or one of React Native's views or a view controller. A text input, or another view that
// keeps an undo history of its own (a canvas), keeps its window's.
BOOL NgNativeAnswersSharedUndo(UIResponder *_Nullable firstResponder);

// Replaces `selector` on `cls` with the block `make` answers, which receives the implementation it
// replaces to call: the class's own, the one it inherited, or NULL where it had none, and `types`
// is the method's type encoding then. A method the class only inherited is added to the class, so
// its superclass is untouched.
void NgNativeHook(Class cls, SEL selector, const char *types, id (^make)(IMP _Nullable previous));

NS_ASSUME_NONNULL_END
