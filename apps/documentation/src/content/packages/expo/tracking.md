---
title: Tracking
summary: Apple's App Tracking Transparency permission, and the advertising identifier behind it.
---

# Tracking

`Tracking` is Apple's App Tracking Transparency permission, bound to `expo-tracking-transparency`.
On iOS 14.5 and later, an app asks before it tracks the user across other companies' apps and
websites, and the advertising identifier is handed out only once the user has said yes.

The question is asked once. After an answer, iOS shows no dialog again, so `permission.blocked()`
is how an app knows to point the user at Settings instead. Android has no such permission, and the
module answers granted there.

## Install

```sh
npx expo install expo-tracking-transparency
```

```ts
import { Tracking } from '@ng-native/expo/tracking';
```

The text in Apple's dialog is `NSUserTrackingUsageDescription`, which the module's config plugin
sets from its `userTrackingPermission` option, with a generic sentence when the option is not
given. The plugin also adds Android's `AD_ID` permission, which the advertising ID needs.

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Tracking } from '@ng-native/expo/tracking';

@Component({
  selector: 'app-consent',
  template: `<pressable (press)="allow()"><text>Personalise ads</text></pressable>`,
})
export class Consent {
  private readonly tracking = inject(Tracking);

  protected async allow(): Promise<void> {
    if (await this.tracking.permission.ensure()) {
      console.log('advertising id', this.tracking.advertisingId());
    }
  }
}
```

## What it does

- **`permission`** - a [`Permission`](/packages/expo/permissions): `ensure()` shows Apple's dialog
  only if it has not been answered, `granted()` and `blocked()` are signals.
- **`available`** - whether the device has the tracking API. Where it does not, the permission
  answers granted.
- **`advertisingId()`** - the IDFA on iOS, the advertising ID on Android. Null on iOS until
  tracking is allowed, in the simulator, and on Android with ad tracking limited.

## Without the module

On iOS and Android, a missing `expo-tracking-transparency` - never installed, or installed without
the app being rebuilt since - throws a `MissingModuleError` when the service first reaches for it.
Its message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, the permission is refused and cannot be asked for,
`available` is `false`, and `advertisingId()` is `null`.

## Reference

<!-- api: Tracking -->
