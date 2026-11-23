---
title: Menus and shortcuts
summary: A menu bar, context menus, press menus and shortcuts, written once as elements for any OS.
---

# Menus and shortcuts

Menus are written as elements: `<menu-item>`s inside a `<menu-bar>`, a `<menu-group>` or a template
given to `[contextMenu]` or a `<pressable>`'s `[menu]`. They draw nothing in place. Each OS draws
the menu its own way, and its items stay in step with their bindings for as long as they are there.

## The menu bar

```angular-html
<menu-bar>
  <menu-group label="File" menuRole="file">
    <menu-item label="New Note" shortcut="mod+n" (select)="create()" />
    <menu-separator />
    <menu-item label="Save" shortcut="mod+s" [disabled]="!dirty()" (select)="save()" />
  </menu-group>
  <menu-group label="View" menuRole="view">
    <menu-item label="Wrap Lines" [(checked)]="wrap" />
  </menu-group>
  <menu-group label="Notes" menuRole="app">
    <menu-item menuRole="settings" label="Settings..." (select)="openSettings()" />
  </menu-group>
</menu-bar>
```

Every desktop app has App, Edit, View, Window and Help menus without writing one. A `<menu-group>`
whose `menuRole` is `app`, `file`, `edit`, `view`, `window` or `help` adds its items to that menu; a
`file` group goes after the App menu, and any other group after View. A group named as one of those
menus but with no `menuRole` is drawn as a second menu of that name, and a warning says so (unless
its items all have roles that move them into the default menus). A `<menu-item>` with a `menuRole`
replaces the standard item for that role, and without `(select)` does what the OS does for it.
Settings... shows only when an item with `menuRole="settings"` has a `(select)`.

On macOS and iPadOS this is the menu bar. On Linux it is a menu bar under each window's header bar
when `XDG_CURRENT_DESKTOP` lists KDE, as KDE Plasma's apps have it, and the header bar's main menu
on every other desktop, as GNOME's apps have it. On iPhone and Android nothing is drawn, and each
item's `shortcut` still works from a hardware keyboard; Android lists them in its Keyboard
Shortcuts helper, under their menu's label.

A `<menu-item>` takes `label`, `menuRole`, `shortcut`, `[disabled]`, `[(checked)]`, `destructive`,
`subtitle`, `sfSymbol` (Apple's OSes) and `icon` (a drawable on Android), and fires `(select)`. A
`<menu-group>` inside a menu is a submenu, or with `inline` a section of the menu it is in.

## Shortcuts

`shortcut` on any element listens for a chord anywhere in the app while the element is there:

```angular-html
<view shortcut="mod+k" shortcutLabel="Search" (shortcutPress)="search()"></view>
```

`mod` is Cmd on Apple's OSes and Ctrl on Android and Linux. The editing keys (mod+z, x, c, v and a)
go to a
focused text input first, so a shortcut on one of them fires only while no text input has focus.

A letter, digit or punctuation key is written as itself: `mod+s`, `mod+,`, `mod++` for the plus
key. Any other key is written by the name `KeyboardEvent.key` gives it, spelt exactly, so `enter`
and `up` are not names:

- `ArrowLeft`, `ArrowRight`, `ArrowUp` and `ArrowDown`
- `Enter`, `Escape`, `Backspace`, `Delete`, `Tab` and `Space`
- `Home`, `End`, `PageUp` and `PageDown`
- `F1` to `F12`

Those work on every OS. A few more are named on some: `Insert` on Android and Linux, `F13` to `F20`
on macOS, Linux and Android 16 and later (UIKit names no key past `F12`, and older Android has no
key code for them), and `Pause`, `ScrollLock` and `ContextMenu` on Android. A name the list does
not have throws when the shortcut is read, with the name it is probably a misspelling of.

On Android a shortcut works from a hardware keyboard once it has a modifier (Ctrl, Alt, Shift or
Meta), and Meta-/ lists it in the Keyboard Shortcuts helper by its `shortcutLabel`, under the app's
name. While a `<modal>` is open, the keyboard goes to the modal's own window, and on Android the
app's shortcuts do not fire there yet.

## Context menus

```angular-html
<pressable [contextMenu]="rowMenu" (press)="open(note)">
  <text>{{ note.title }}</text>
</pressable>
<ng-template #rowMenu>
  <menu-item label="Rename" sfSymbol="pencil" icon="ic_edit" (select)="rename(note)" />
  <menu-item label="Delete" destructive (select)="remove(note)" />
</ng-template>
```

A right-click opens it on macOS, and on Linux as a popover menu at the point. On Android a long
press or a right-click opens it as a menu at the
press point, and there the long press is the menu's, so the element's `(longPress)` does not also
fire. TalkBack opens it with the element's long-press action (double-tap and hold). A destructive
item's label is red, `icon` names a drawable resource shown beside the label (Android 10 and
later), and `subtitle` is not shown on Android. Android finds the view by its `nativeID`, so an
element without one is given one. Menus inside a `<modal>` do not open on Android yet.

A view with a `nativeID` is a stacking context, as one with `opacity` below 1 is: a `z-index`
inside an element with a menu orders its children against each other, not against the element's
siblings. A `<pressable>` is one already. On Android and iOS, put a dropdown that has to paint
over the next row outside the element with the menu, or give it a `z-index` on the element itself.

On Android and iOS the innermost handler wins a long press, as in a native app: a `<pressable>` with
its own `(longPress)` inside the element keeps its long press, and the menu opens only on a long
press nothing inside it takes. A `<pressable>` around the element leaves a long press on it to the
menu, whatever its `delayLongPress`. On Android a right-click there still opens the menu. iOS tells
a long press from an iPad pointer's secondary click only by the gesture, so a secondary click there
opens no menu either.

```angular-html
<view [contextMenu]="rowMenu">
  <text>{{ note.title }}</text>
  <pressable (longPress)="startReorder(note)"><text>Move</text></pressable>
</view>
```

On iOS and iPadOS a long press opens it, as does a secondary click from an iPad pointer, and the
long press is the menu's there too. iOS adds the menu to the element's own view, found by its
`nativeID` as on Android, so a `nativeID` the app gives should be unique on screen. Both need the
native side of `@ng-native/components`, which a development build has and Expo Go does not: in
Expo Go the menu does not open, and `(longPress)` fires as it would without one. The web host does
not draw it.

## Menus on a press

```angular-html
<pressable [menu]="sortMenu">
  <text>Sort by {{ sortLabel() }}</text>
</pressable>
<ng-template #sortMenu>
  <menu-item label="Name" [checked]="sort() === 'name'" (select)="sort.set('name')" />
  <menu-item label="Date" [checked]="sort() === 'date'" (select)="sort.set('date')" />
</ng-template>
```

`[menu]` on a `<pressable>` opens its menu under the element on a press: a click, a screen
reader's press, or on macOS Space while it has focus. `(press)` does not fire then. The menu is
written as a context menu's is, and a one-way `[checked]` stays as the app binds it, so a menu of
choices like this one is a pop-up select. `open()` opens it from code, named in the template with
`#sort="pressMenu"`, and says whether it asked the host to open it: it answers `true` even when the
host then draws nothing, for an element not on screen.

macOS draws it as a menu under the element, and Linux as a popover menu below it. iOS, Android,
Expo Go and the web host draw none yet: there a press fires `(press)` as it would without
`[menu]`, and a warning in development says so once. A menu that shows no item opens nothing, and
the press fires `(press)`.

## Reference

<!-- api: MenuItem -->

<!-- api: MenuGroup -->

<!-- api: ContextMenu -->

<!-- api: PressMenu -->

<!-- api: Shortcut -->
