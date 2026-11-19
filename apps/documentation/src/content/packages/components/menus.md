---
title: Menus and shortcuts
summary: A menu bar, context menus and keyboard shortcuts, written once as elements for every OS.
---

# Menus and shortcuts

Menus are written as elements: `<menu-item>`s inside a `<menu-bar>`, a `<menu-group>` or a template
given to `[contextMenu]`. They draw nothing in place. Each OS draws the menu its own way, and its
items stay in step with their bindings for as long as they are there.

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

On macOS and iPadOS this is the menu bar. On iPhone and Android nothing is drawn, and each item's
`shortcut` still works from a hardware keyboard; Android lists them in its Keyboard Shortcuts
helper, under their menu's label.

A `<menu-item>` takes `label`, `menuRole`, `shortcut`, `[disabled]`, `[(checked)]`, `destructive`,
`subtitle`, `sfSymbol` (Apple's OSes) and `icon` (a drawable on Android), and fires `(select)`. A
`<menu-group>` inside a menu is a submenu, or with `inline` a section of the menu it is in.

## Shortcuts

`shortcut` on any element listens for a chord anywhere in the app while the element is there:

```angular-html
<view shortcut="mod+k" shortcutLabel="Search" (shortcutPress)="search()"></view>
```

`mod` is Cmd on Apple's OSes and Ctrl on Android. The editing keys (mod+z, x, c, v and a) go to a
focused text input first, so a shortcut on one of them fires only while no text input has focus.

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

A right-click opens it on macOS. On Android a long press or a right-click opens it as a menu at the
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

## Reference

<!-- api: MenuItem -->

<!-- api: MenuGroup -->

<!-- api: ContextMenu -->

<!-- api: Shortcut -->
