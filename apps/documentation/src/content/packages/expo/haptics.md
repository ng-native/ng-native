---
title: Haptics
summary: Impact, notification and selection feedback, fired and forgotten.
---

# Haptics

`Haptics` fires haptic feedback: a collision, a success or failure, a selection change.

It talks to Expo's native module directly rather than through `expo-haptics`'s own JavaScript,
which adds exactly one thing on top: a throw when the module is missing. Asking for it optionally
answers the same question without the throw, and sidesteps the enum its functions take. The
`expo-haptics` package still has to be installed - that is what links the native side.

## Install

```sh
npx expo install expo-haptics
```

```ts
import { Haptics } from '@ng-native/expo/haptics';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Haptics } from '@ng-native/expo/haptics';

@Component({
  selector: 'app-save-button',
  imports: [Pressable, Text],
  template: `<pressable (press)="save()"><text>Save</text></pressable>`,
})
export class SaveButton {
  private readonly haptics = inject(Haptics);

  protected save(): void {
    this.haptics.notify('success');
  }
}
```

## What it does

- **`impact(style)`** - a collision between interface elements. `style` is `'light'`, `'medium'`
  (the default), `'heavy'`, `'rigid'` or `'soft'`. `'rigid'` and `'soft'` need iOS 13+.
- **`notify(type)`** - a task succeeded or failed: `'success'`, `'warning'` or `'error'`. iOS plays
  a distinct pattern for each.
- **`select()`** - a selection changed, the lightest of the three.
- **`available`** - whether the native module is installed at all.

Every method returns nothing and swallows the failures of a vibration. Expo's own equivalents are
all promises, and a caller who does not await one gets an unhandled rejection on a device with no
Taptic Engine, in a simulator, or on an Android build with the vibration permission off - none of
which is a reason for anything to go wrong on screen. Nobody awaits a vibration, so nothing here
surfaces one going nowhere; if that ever needs debugging, add logging under `__DEV__` rather than
making call sites handle a rejection. A module missing from the build is not one of those: it
throws, as below.

## Without the module

On iOS and Android, a missing `expo-haptics` - never installed, or installed without the app being
rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of a
value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).
`available` is `false`.

On the web, and in a test that provides no fake, every method does nothing. `available` is `false`.

## Reference

<!-- api: Haptics -->
