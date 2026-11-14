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
`file` group goes after the App menu, and any other group after View. A `<menu-item>` with a
`menuRole` replaces the standard item for that role, and without `(select)` does what the OS does
for it. Settings... shows only when an item with `menuRole="settings"` has a `(select)`.

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

A right-click opens it on every OS with a pointer. On iOS a long press opens it with the system's
preview lift, and on Android a long press opens it at the press point. There, the long press is the
menu's, so the element's `(longPress)` does not also fire.

## Reference

<!-- api: MenuItem -->

<!-- api: MenuGroup -->

<!-- api: ContextMenu -->

<!-- api: Shortcut -->
