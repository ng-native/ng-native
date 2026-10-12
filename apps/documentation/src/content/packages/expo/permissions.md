---
title: Permissions
summary: Permission turns any Expo module's get/request pair into signals.
---

# Permissions

Nearly every Expo module that needs a permission exposes the same shape: a `getXPermissionsAsync`,
a `requestXPermissionsAsync`, and a `useXPermissions()` hook that is those two plus React state.
`Permission` rebuilds that hook as signals, for any module's pair of functions - it is not a facade
per module, so the module stays your app's own dependency, and it is what
[`ImagePicker`](/packages/expo/image-picker), [`Location`](/packages/expo/location) and
[`Camera`](/packages/expo/camera) are built on.

`Permission` lives on the bare `@ng-native/expo` import, not behind an entry point - it is not
bound to one optional module.

## Install

Nothing extra: `Permission` needs no Expo module of its own. Use it against whichever module's
permission functions you are calling.

```ts
import { Permission } from '@ng-native/expo';
```

## The smallest thing that works

```ts
import * as Camera from 'expo-camera';
import { Component, inject } from '@angular/core';
import { Permission } from '@ng-native/expo';

@Component({ selector: 'app-scanner', template: '<text>{{ camera.status() }}</text>' })
export class Scanner {
  protected readonly camera = Permission.of(
    Camera.Camera.getCameraPermissionsAsync,
    Camera.Camera.requestCameraPermissionsAsync,
  );

  protected async scan(): Promise<void> {
    if (await this.camera.ensure()) this.startScanning();
  }

  private startScanning(): void {}
}
```

## Building one

**`Permission.of(get, request)`** takes a module's own pair of functions and returns a
`Permission`. Nothing is asked until you call one of the methods below - constructing it does not
touch the platform.

```ts
readonly notifications = Permission.of(getPermissionsAsync, requestPermissionsAsync);
```

## Reading and asking

- **`status`** is a signal: `'granted'`, `'denied'` or `'undetermined'` - or **`'unknown'`** before
  anything has asked the platform, which is not the same as `'undetermined'`. `'undetermined'`
  means the platform has been asked and the person has not decided; `'unknown'` means nobody has
  asked yet.
- **`granted`** is a signal: whether the permission is currently granted.
- **`blocked`** is a signal: true once the platform will no longer show a dialog at all - refused
  for good. This is the moment to send the person to Settings instead of asking again, with
  [`DeepLinks`](/packages/device/deep-links)' `openSettings()`. It is not final: see
  [Coming back from Settings](#coming-back-from-settings).
- **`check()`** asks the platform what it currently thinks, without showing the person anything.
- **`request()`** shows the dialog and resolves to whether they granted it.
- **`ensure()`** is the method most call sites want: it has the permission if it can be had, and
  only shows a dialog if showing one would do something. A granted answer is kept, so it returns
  `true` without asking the platform again. Anything else, including nothing asked yet, is checked
  first, which shows nothing. Then it returns `true` if granted, `false` if blocked (asking again
  would resolve to the same no while reading as though the person had been consulted twice), and
  otherwise shows the request dialog.

```ts
protected async open(): Promise<void> {
  if (await this.camera.ensure()) this.scanning.set(true);
}
```

## Coming back from Settings

A permission refused for good can still be turned on in Settings, and neither platform restarts the
app for that. So a no is never taken as final:

- **`ensure()`** checks a no again before answering. The next tap after the person comes back
  works, with no dialog.
- A `Permission` built in an injection context (a field of a service or a component, as above)
  also checks a no again each time the app comes back to the front, so `blocked`, `granted` and
  `status` change by themselves and a "turn it on in Settings" screen can go away. It stops when
  that service or component is destroyed. One built outside an injection context only changes when
  you call `check()`, `request()` or `ensure()`.

A granted answer is not checked again either way, which keeps the common path free of platform
calls. Call `check()` where you need to know a permission was not turned off since.

## Reference

<!-- api: Permission -->
