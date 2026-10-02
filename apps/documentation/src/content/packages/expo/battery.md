---
title: Battery
summary: The battery level, charging state and Low Power Mode, as signals.
---

# Battery

`Battery` reports the level, charging state and power-saving mode, for the work an app should not
be doing on 5%.

## Install

```sh
npx expo install expo-battery
```

```ts
import { Battery } from '@ng-native/expo/battery';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { Battery } from '@ng-native/expo/battery';

@Component({
  selector: 'app-status',
  imports: [Text],
  template: `
    @if (battery.low()) {
      <text>Battery saver recommended</text>
    }
  `,
})
export class Status {
  protected readonly battery = inject(Battery);
}
```

## What it reports

- **`level`** - nought to one. Starts at `1` until the platform answers, since an app should not
  open dimmed.
- **`known`** - whether the platform will actually say. False on a simulator, and on a device that
  reports a level of `-1`: iOS answers `-1` for "no battery to report on", and `level` treats that
  as `1` rather than passing a negative number through as a real reading that happens to be below
  every threshold an app has.
- **`state`** - `'unknown'`, `'unplugged'`, `'charging'` or `'full'`. Android's `NOT_CHARGING`
  (plugged in and holding) reads as `'full'`: for every purpose an app has, the battery is not
  going down.
- **`charging`** - true when `state` is `'charging'` or `'full'`.
- **`saving`** - Low Power Mode on iOS, Battery Saver on Android. Starts `false`.
- **`low`** - under a fifth and not charging: the point at which an app should start doing less.
  False whenever the level is unknown, since "I cannot tell" and "almost flat" are not the same
  answer and only one of them is a reason to degrade.

## Without the module

On iOS and Android, a missing `expo-battery` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `level` reads `1`, `known` is `false`, `state` is
`'unknown'`, `saving` and `low` are `false`.

## Reference

<!-- api: Battery -->
