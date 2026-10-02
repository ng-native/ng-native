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
import { Brightness } from '@ng-native/expo/brightness';

@Component({
  selector: 'app-boarding-pass',
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
- **`restore()`** - puts the system's brightness back at once, whatever is still set. Available
  directly if a screen needs to put the brightness back without waiting for teardown.

## Without the module

On iOS and Android, a missing `expo-brightness` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `level` stays at `1`. `set()` and `restore()` do
nothing and do not throw.

## Reference

<!-- api: Brightness -->
