---
title: Device orientation
summary: The screen orientation, and locking it, through expo-screen-orientation.
---

# Device orientation

`DeviceOrientation` reports the screen orientation and lets you lock it through
`expo-screen-orientation`.

`DeviceOrientation` wraps `expo-screen-orientation`'s own `getOrientationAsync()`, which reports how
the screen is currently laid out - the same value the platform uses to decide whether to rotate -
not the physical attitude of the device measured against gravity. A layout that only wants to know
which way its own view is laid out should reach for the CSS `orientation` media feature instead,
which needs none of this. Locking the screen with `lock()` changes what this signal can report:
once locked to portrait, `DeviceOrientation` reports portrait, whatever way the phone is actually
held. An app that needs the phone's physical attitude - a level, a game controller - wants a motion
sensor from [Sensors](/packages/expo/sensors), not this.

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
import { DeviceOrientation } from '@ng-native/expo/orientation';

@Component({
  selector: 'app-player',
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

On iOS and Android, a missing `expo-screen-orientation` - never installed, or installed without the
app being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read
of a value only the module knows, throws a `MissingModuleError`. Its message names the module and
the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `orientation` stays `'unknown'` and `landscape`
stays `false`. `lock()` returns a function that does nothing.

## Reference

<!-- api: DeviceOrientation -->
