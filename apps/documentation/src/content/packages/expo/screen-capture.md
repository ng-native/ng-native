---
title: Screen capture
summary: Keep a screen out of screenshots and recordings, and count the screenshots taken.
---

# Screen capture

`ScreenCapture` keeps sensitive screens out of screenshots and screen recordings, and counts the
screenshots the user takes, bound to `expo-screen-capture`.

Preventing capture is held by a key, and stays on while any key is held: a payment screen and a
passwords screen that each prevent it do not undo each other when one of them closes. The
screenshot count is a signal, and the listener behind it lives as long as the app does and is
removed when the app is destroyed.

## Install

```sh
npx expo install expo-screen-capture
```

```ts
import { ScreenCapture } from '@ng-native/expo/screen-capture';
```

## The smallest useful example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { ScreenCapture } from '@ng-native/expo/screen-capture';

@Component({
  selector: 'app-card-details',
  template: `
    <text>4242 4242 4242 4242</text>
    @if (capture.screenshots() > 0) {
      <text>Screenshots of this screen show your card number.</text>
    }
  `,
})
export class CardDetails {
  protected readonly capture = inject(ScreenCapture);

  constructor() {
    void this.capture.prevent('card-details');
    inject(DestroyRef).onDestroy(() => void this.capture.allow('card-details'));
  }
}
```

## What it does

- **`screenshots`** - a signal: how many screenshots the user has taken while the app was in
  front. The event carries nothing else, so a count is all there is to hold.
- **`prevent(key?)`** - keeps the app out of screenshots and screen recordings until `allow()` is
  called with the same key, or the app restarts. Without a key, one shared default key is used.
- **`allow(key?)`** - releases the key. Capture is allowed again once no key is held.
- **`available()`** - whether the platform can prevent capture.
- **`protectAppSwitcher(blurIntensity?)`** and **`unprotectAppSwitcher()`** - iOS: blurs the app
  while it is not in focus - in the app switcher, in the background, during interruptions - by an
  intensity from 0 to 1, half by default. Android already hides it in the app switcher while
  capture is prevented.
- **`permission`** - a [`Permission`](/packages/expo/permissions) for screenshot detection. Android
  13 and earlier need it, since detection reads the photo library; later Android needs none, and
  iOS always answers granted.

## Without the module

On iOS and Android, a missing `expo-screen-capture` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `screenshots` stays at `0`, `available()` resolves
to `false`, the permission is refused, and every other method resolves without doing anything.

## Reference

<!-- api: ScreenCapture -->
