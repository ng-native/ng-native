---
title: Brightness
summary: Set and restore the app's own screen brightness, for a boarding pass or a QR code.
---

# Brightness

`Brightness` sets the screen brightness for the app's own window, and puts it back. It is for the
screens that have a genuine reason to change it - a boarding pass, a QR code - not for a system
setting.

The app's own brightness only. The system brightness is a global setting an app can leave changed
after it is gone, and needs a permission on Android, so reaching for it is a decision to make
deliberately against Expo's own API rather than a convenience this offers.

## Install

```sh
npx expo install expo-brightness
```

```ts
import { Brightness } from '@ng-native/expo/brightness';
```

## The smallest useful example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { Brightness } from '@ng-native/expo/brightness';

@Component({
  selector: 'app-boarding-pass',
  imports: [Text],
  template: `<text>Show this at the gate</text>`,
})
export class BoardingPass {
  private readonly brightness = inject(Brightness);

  constructor() {
    const restore = this.brightness.set(1);
    inject(DestroyRef).onDestroy(restore);
  }
}
```

## What it does

- **`level`** - a signal, nought to one. Starts at `1`, since that is what a screen already shows
  before anything asks the platform.
- **`set(level)`** - clamps to `0..1`, applies it, and returns the function that puts back what
  was there before: the level an earlier `set()` still holds, such as the screen underneath a
  pushed one, or the system's own brightness once nothing does. Always use the returned function
  rather than calling `restore()` separately: an app that leaves the screen at full brightness
  after showing a boarding pass is one the user experiences as a battery fault, not a bug they
  can name.
- **`restore()`** - puts back at once every level this app still has set: the system's
  brightness, or the level of another app the runtime mounts that still has one. Available directly
  if a screen needs to put the brightness back without waiting for teardown.

Levels stack across every app the runtime mounts, and an app that is destroyed puts back its own.
On Android, an activity that comes to the front is given the level again.

iOS has no window level of the app's own: the level set is the screen's, and it stays after the
app until the device locks. So when no app holds a level, the next `set()` first reads the level
the screen has. When the last level is dropped, or `restore()` is called, that level is set again,
so a change made in Control Center while a level was held is undone. If the level cannot be read,
nothing is put back. Leaving the app while a level is held, without dropping it, keeps the screen
at that level until the device locks.

## Without the module

On iOS and Android, a missing `expo-brightness` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of
a value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `level` stays at `1`. `set()` and `restore()` do
nothing and do not throw.

## Reference

<!-- api: Brightness -->
