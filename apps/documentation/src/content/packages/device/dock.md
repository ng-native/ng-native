---
title: Dock and tray
summary: A menu and a bounce on the app's Dock icon, and icons in the macOS menu bar's status area.
---

# Dock and tray

On macOS an app has a Dock icon, and can put icons in the status area at the right of the menu bar.
On iOS and Android neither exists: `Dock.available()` and `Tray.available()` are `false`, and every
call does nothing.

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
image asset of the app's own. A menu-bar-only app pairs it with `provideMainWindow({ autoOpen: false
})`; see [Windows](/packages/device/app-windows).

## Reference

<!-- api: Dock -->

<!-- api: @ng-native/components#TrayIcon -->
