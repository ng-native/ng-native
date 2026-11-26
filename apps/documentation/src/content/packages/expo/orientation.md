---
title: Device orientation
summary: The screen orientation, and locking it, through expo-screen-orientation.
---

# Device orientation

`DeviceOrientation` reports the screen orientation and lets you lock it through
`expo-screen-orientation`.

<!-- platforms: DeviceOrientation -->

It reports how the screen is laid out, not how the device is held: once `lock()` locks it to
portrait, it reports portrait whatever way the phone is turned. For the layout alone, the CSS
`orientation` media feature needs none of this; for the device's physical attitude, use a motion
sensor from [Sensors](/packages/expo/sensors).

## Install

```sh
npx expo install expo-screen-orientation
```

```ts
import { DeviceOrientation } from '@ng-native/expo/orientation';
```

## The smallest useful example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { DeviceOrientation } from '@ng-native/expo/orientation';

@Component({
  selector: 'app-player',
  imports: [Text],
  template: `<text>Playing in {{ orientation.orientation() }}</text>`,
})
export class Player {
  private readonly orientation = inject(DeviceOrientation);

  constructor() {
    const unlock = this.orientation.lock('landscape');
    inject(DestroyRef).onDestroy(unlock);
  }
}
```

## What it reports and does

- **`orientation`** - `'unknown'`, `'portrait'`, `'portrait-upside-down'`, `'landscape-left'` or
  `'landscape-right'`. Starts `'unknown'`.
- **`landscape`** - true whenever `orientation` starts with `landscape`.
- **`lock(lock)`** - pins the screen to `'default'` (portrait, and on a phone nothing else),
  `'all'`, `'portrait'` or `'landscape'`. Returns the function that unlocks it, ready to hand
  straight to `DestroyRef.onDestroy` so a screen that wants landscape while it is up does not have
  to think about it again. Locks stack: releasing one puts back the lock an earlier `lock()` still
  holds, such as the screen underneath a pushed one, and the screen unlocks once none is held.
  Locks stack across every app the runtime mounts, and an app that is destroyed releases its own.
  On Android, an activity that comes to the front is locked again.

## Without the module

On iOS and Android, a missing `expo-screen-orientation` throws a
[`MissingModuleError`](/packages/expo/using-a-module#what-happens-without-the-module-installed) on
the first call or read that needs it. Injecting the service does not throw.

On the web, and in a test that provides no fake, `orientation` stays `'unknown'` and `landscape`
stays `false`. `lock()` returns a function that does nothing.

## Reference

<!-- api: DeviceOrientation -->
