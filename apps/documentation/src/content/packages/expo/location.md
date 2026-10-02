---
title: Location
summary: A position signal, filled once by current() or continuously by start().
---

# Location

`Location` wraps `expo-location`'s foreground position: a `position` signal that a one-off
`current()` and a running `start()` both write to. Nothing is watched until you call one of them,
and the accuracy is explicit - GPS at navigation accuracy is a battery the user notices.

## Install

```sh
npx expo install expo-location
```

```ts
import { Location } from '@ng-native/expo/location';
```

## The smallest thing that works

```ts
import { Component, inject, type OnDestroy } from '@angular/core';
import { Location } from '@ng-native/expo/location';

@Component({
  selector: 'app-run',
  template: `
    @if (location.position(); as here) {
      <text>{{ here.latitude }}, {{ here.longitude }}</text>
    }
  `,
})
export class Run implements OnDestroy {
  protected readonly location = inject(Location);
  private stop = () => {};

  async start(): Promise<void> {
    this.stop = await this.location.start({ accuracy: 'high', distance: 10 });
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
```

## Reading a position

- **`position`** is a signal: null until something has been read, then the latest fix -
  `latitude`, `longitude`, `altitude`, `accuracy`, `heading`, `speed` and `timestamp`. `altitude`,
  `accuracy`, `heading` and `speed` are null where the platform does not know them.
- **`current(accuracy)`** reads the position once and returns it (or null, without the permission
  or the module).
- **`start({ accuracy, distance, interval })`** follows the position into the signal, resolving to
  the function that stops watching. `distance` is meters moved before the next update; `interval`
  is milliseconds between updates, Android only - iOS updates on distance moved, not on a timer.
- The accuracy is a name, not Expo's numeric enum: `lowest`, `low`, `balanced` (the default),
  `high`, `highest` or `navigation`. Worth choosing deliberately: `navigation` keeps the GPS hot.

Both `current()` and `start()` ask for the foreground permission themselves, via
`location.permission` (see [Permissions](/packages/expo/permissions)), and do nothing without it -
`current()` resolves to null, `start()` to a stop function that does nothing. Location in the
background is not wrapped by this service; use `expo-location`'s own background API directly if
you need it.

Add to `Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Allow this app to use your location</string>
```

Android's `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` permissions are added automatically
by the module's config plugin.

## Without the module

On iOS and Android, a missing `expo-location` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `permission` reports `denied` with `canAskAgain:
false`. `current()` resolves to null and `start()` to a stop function that does nothing, exactly as
though the permission had been refused.

## Reference

<!-- api: Location -->
