---
title: Dock and tray
summary: A menu and a bounce on the app's Dock icon, and icons in the macOS menu bar's status area.
---

# Dock and tray

On macOS an app has a Dock icon, and can put icons in the status area at the right of the menu bar.
On Linux tray icons go in the panel's status area, as StatusNotifierItems, where the desktop runs a
StatusNotifierWatcher (KDE Plasma, and GNOME with the AppIndicator extension), and there is no Dock.
On iOS and Android neither exists. Where one is missing its `available()` is `false`, and every
call does nothing.

<!-- platforms: Dock, Tray -->

## The Dock

```ts
import { Dock } from '@ng-native/device';

const dock = inject(Dock);
dock.setMenu([{ label: 'New Window', select: () => windows.open(Editor) }]);
const stop = dock.bounce({ critical: true });
```

`setMenu` puts items above the ones macOS adds to the Dock icon's menu, and `null` takes them away.
`bounce` bounces the icon once, or with `critical` until the app comes to the front, and answers a
function that stops it. The Dock badge is the [Notifications](/packages/expo/notifications) badge
count, as an app icon's is on iOS: `Notifications.setBadge(3)`.

## Tray icons

A `<tray-icon>` shows an icon for as long as the element is there. Its `<menu-item>`s are the menu a
click opens; with none, a click fires `(press)`.

```angular-html
<tray-icon sfSymbol="timer" [title]="remaining()" tooltip="Focus timer">
  <menu-item label="Pause" (select)="pause()" />
  <menu-separator />
  <menu-item menuRole="quit" label="Quit" />
</tray-icon>
```

`sfSymbol` draws a symbol that follows the menu bar's light or dark appearance; `image` names an
image asset of the app's own. `icon` takes the picture as one value, as
[`<native-button>`](/packages/components/native-button) does: `{ sfSymbol }`, or an icon's SVG
markup, `{ svg }`, such as an `@ng-icons` icon, which macOS draws as it draws a symbol. On Linux
`image` names an icon in the icon theme, the app's own icon stands in without one, and `sfSymbol` is
not drawn. An SVG icon is drawn as a picture of its own, and its menu items' SVG icons too: the
panel draws a picture as it is given, so the icon is light on GNOME, whose top bar is dark in either
style, and elsewhere, as on KDE Plasma, whose panel follows the colour scheme, light in the dark
style and dark in the light one. A menu-bar-only app pairs it with
`provideMainWindow({ autoOpen: false })`; see [Windows](/packages/device/app-windows).

## Reference

<!-- api: Dock -->

<!-- api: @ng-native/components#TrayIcon -->
