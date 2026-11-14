// Menus as the app sends them (`serializeMenu` in @ng-native/device: an `id` per item, `label`,
// `shortcut`, `disabled`, `checked`, `destructive`, `subtitle`, `sfSymbol`, `inline`, `items`, and
// `{ separator: true }` between groups) made into UIKit menu elements. A context menu and the iPad
// menu bar share it.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// What choosing an item does: its id, sent back to the app.
typedef void (^NgNativeMenuChoose)(NSString *itemId);

// `entries` as menu elements. A separator splits the items around it into inline groups, as UIKit
// draws dividers. With `keyCommands`, an item with a shortcut becomes a UIKeyCommand with
// `action`, its id in `propertyList`, as a menu bar item; otherwise each item is a UIAction that
// calls `choose`. Role items the OS does itself (no `handled`) are left out: UIKit's own menus
// already have them.
NSArray<UIMenuElement *> *NgNativeMenuElements(
    NSArray *entries,
    NgNativeMenuChoose choose,
    SEL _Nullable keyCommandAction);

// A shortcut (`{ key, meta, ctrl, alt, shift }`) as UIKeyCommand's input and modifier flags. Nil
// for a key UIKit cannot name.
NSString *_Nullable NgNativeKeyInput(NSDictionary *shortcut, UIKeyModifierFlags *flags);

NS_ASSUME_NONNULL_END
