---
title: Keep awake
summary: Hold the screen on with a tag, for as long as something needs it and no longer.
---

# Keep awake

`KeepAwake` holds the device's screen on, bound to `expo-keep-awake`.

It is never a bare activate: a screen that holds the display on and never releases it is a phone
that never sleeps, which the user experiences as a battery fault and never attributes to the app
that caused it. `hold()` always returns the function that releases it.

## Install

```sh
npx expo install expo-keep-awake
```

```ts
import { KeepAwake } from '@ng-native/expo/keep-awake';
```

## The smallest useful example

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { KeepAwake } from '@ng-native/expo/keep-awake';

@Component({
  selector: 'app-recording',
  template: `<text>Recording...</text>`,
})
export class Recording {
  constructor() {
    inject(DestroyRef).onDestroy(inject(KeepAwake).hold('recording'));
  }
}
```

## What it does

- **`hold(tag)`** - holds the screen on under that tag, and returns the function that releases it.
  The tag defaults to a package-wide constant. Holds are counted per tag, so two screens holding
  the same tag, or the default, each keep the screen on until their own hold is released; naming
  the tag is what tells them apart in `holders`.
- **`holders`** - a signal of the set of tags currently holding the screen on, for a debug screen
  that wants to say which.
- **`active`** - whether anything currently holds the screen on, computed from whether `holders` is
  non-empty.

Releasing the same hold twice does nothing the second time.

## Without the module

On iOS and Android, a missing `expo-keep-awake` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `hold()` still tracks the tag in `holders` and
`active`, but nothing on the device changes and `stop` calls into a module that is not there safely.

## Reference

<!-- api: KeepAwake -->
