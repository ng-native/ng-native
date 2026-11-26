---
title: Keep awake
summary: Hold the screen on with a tag, for as long as something needs it and no longer.
---

# Keep awake

`KeepAwake` holds the device's screen on, bound to `expo-keep-awake`.

<!-- platforms: KeepAwake -->

`hold()` always returns the function that releases it.

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
import { Text } from '@ng-native/components';
import { KeepAwake } from '@ng-native/expo/keep-awake';

@Component({
  selector: 'app-recording',
  imports: [Text],
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

Releasing the same hold twice does nothing the second time. Holds are counted across every app the
runtime mounts, and an app that is destroyed releases the holds it still has. On Android, each time
an activity comes to the front, a recreated one included, every held tag is released and taken
again. A new activity starts with its screen free to sleep, and `expo-keep-awake`, which keeps its
tags for as long as the runtime runs, turns the screen on only when its first tag comes.

## Without the module

On iOS and Android, a missing `expo-keep-awake` throws a
[`MissingModuleError`](/packages/expo/using-a-module#what-happens-without-the-module-installed) on
the first call or read that needs it. Injecting the service does not throw.

On the web, and in a test that provides no fake, `hold()` still tracks the tag in `holders` and
`active`, but nothing on the device changes and `stop` calls into a module that is not there safely.

## Reference

<!-- api: KeepAwake -->
