---
title: App info
summary: The app's version, build and identifier, and the device it is running on, as plain values.
---

# App info

`AppInfo` reports the app's own version and build, and the device it is running on, bound to
`expo-application` and `expo-device`.

These are constants, read once, rather than signals: none of them changes while the app runs.
Anything the platform does not say is null, and so is everything from a module that is not
installed.

## Install

```sh
npx expo install expo-application expo-device
```

```ts
import { AppInfo } from '@ng-native/expo/app-info';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { AppInfo } from '@ng-native/expo/app-info';

@Component({
  selector: 'app-about',
  template: `<text>{{ info.version }} ({{ info.build }}) on {{ info.device.model }}</text>`,
})
export class About {
  protected readonly info = inject(AppInfo);
}
```

## What it reports

From `expo-application`:

- **`version`** - the version people see: `CFBundleShortVersionString` on iOS, Android's
  `versionName`.
- **`build`** - the build number: `CFBundleVersion` on iOS, Android's `versionCode`.
- **`id`** - the bundle identifier on iOS, the package name on Android.
- **`name`** - the name under the icon.

From `expo-device`, on `device`:

- **`model`** - `iPhone 17 Pro`, `Pixel 9`.
- **`brand`**
- **`os`** - `iOS`, `iPadOS`, `Android`.
- **`osVersion`**
- **`physical`** - false in a simulator or emulator.
- **`type`** - `'phone'`, `'tablet'`, `'desktop'`, `'tv'` or `'unknown'`, null if the platform did
  not say.

## Without the module

On iOS and Android, a missing `expo-application` and `expo-device` - never installed, or installed
without the app being rebuilt since - throws a `MissingModuleError` when the service first reaches
for it. Its message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `version`, `build`, `id` and `name` are all null
without `expo-application`. `device` is every field null and `physical` null without `expo-device`.
Each module is independent: installing only one still fills in what it can.

## Reference

<!-- api: AppInfo -->
