---
title: Biometrics
summary: Face ID, Touch ID and fingerprint unlock through one authenticate() call.
---

# Biometrics

`Biometrics` wraps `expo-local-authentication`: whether the device can authenticate the person in
front of it, and the system prompt that does it.

## Install

```sh
npx expo install expo-local-authentication
```

```ts
import { Biometrics } from '@ng-native/expo/biometrics';
```

## The smallest thing that works

```ts
import { Component, inject } from '@angular/core';
import { Biometrics } from '@ng-native/expo/biometrics';

@Component({
  selector: 'app-wallet',
  template: '<pressable (press)="unlock()"><text>Unlock</text></pressable>',
})
export class Wallet {
  private readonly biometrics = inject(Biometrics);

  protected async unlock(): Promise<void> {
    if (!(await this.biometrics.available())) return;
    const result = await this.biometrics.authenticate('Unlock your wallet');
    if (result.success) this.reveal();
  }

  private reveal(): void {}
}
```

## Checking and asking

- **`available()`** resolves to whether there is a sensor _and_ something enrolled on it - whether
  asking can succeed at all. Check it before showing a "Use Face ID" button.
- **`kinds()`** resolves to the kinds the device has - `'fingerprint'`, `'face'`, `'iris'` - so a
  button can say "Use Face ID" rather than the generic "Use biometrics".
- **`authenticate(message, options)`** shows the system prompt with `message` as the reason, and
  resolves to `{ success: true }` or `{ success: false, error }`, where `error` is the platform's
  own reason: `'user_cancel'`, `'lockout'`, `'not_enrolled'` and so on. `options` is
  `expo-local-authentication`'s own `LocalAuthenticationOptions` (minus `promptMessage`, which
  `message` supplies), for things like `disableDeviceFallback` and `cancelLabel`.

## Face ID needs a usage string

Face ID ends the app the first time it is asked for without one. Add to `Info.plist`:

```xml
<key>NSFaceIDUsageDescription</key>
<string>Allow this app to use Face ID</string>
```

The module's config plugin writes this automatically. Android's `USE_BIOMETRIC` and
`USE_FINGERPRINT` permissions are added automatically too - there is no separate ask-at-runtime
permission dialog on either platform; `authenticate()` itself shows the system UI.

## Without the module

On iOS and Android, a missing `expo-local-authentication` - never installed, or installed without
the app being rebuilt since - throws a `MissingModuleError` when the service first reaches for it.
Its message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, **`authenticate()` fails rather than passes**
without the module - `{ success: false, error: 'not_available' }` - unlike every other service here,
which falls back to reporting nothing. A lock that opens when its sensor is missing is not a lock.
`available()` resolves to `false` and `kinds()` to an empty list.

## Reference

<!-- api: Biometrics -->
