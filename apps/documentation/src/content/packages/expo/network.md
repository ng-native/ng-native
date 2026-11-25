---
title: Network
summary: Connection type and a reachability estimate, as signals - not proof a request will land.
---

# Network

`Network` exposes the platform's connection and internet-reachability estimates. `connected` is
whether there is a connection of any kind; `reachable` is the platform's `isInternetReachable`
estimate, the same value as `connected` on iOS, and not a probe of your server. Branch an offline
banner on it, and handle a failed request where it fails.

<!-- platforms: Network -->

## Install

```sh
npx expo install expo-network
```

```ts
import { Network } from '@ng-native/expo/network';
```

## The smallest useful example

```ts
import { Component, computed, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { Network } from '@ng-native/expo/network';

@Component({
  selector: 'app-banner',
  imports: [Text],
  template: `
    @if (offline()) {
      <text>You're offline</text>
    }
  `,
})
export class Banner {
  private readonly network = inject(Network);
  protected readonly offline = computed(() => this.network.reachable() === false);
}
```

## What it reports

- **`status`** - the full `{ connected, type, reachable }` object.
- **`connected`** - whether there is a connection of any kind. Say what you mean: this is not
  reachability.
- **`type`** - `'wifi'`, `'cellular'`, `'ethernet'`, `'bluetooth'`, `'vpn'`, `'other'`, `'none'` or
  `'unknown'`, for a screen that offers to wait for wifi before a large download.
- **`reachable`** - `boolean | null`. Null until the platform has established it, which is **not**
  the same as offline. An offline banner that treats null as false flashes on every cold start,
  before the platform has had the chance to say either way.

## Without the module

On iOS and Android, a missing `expo-network` throws a
[`MissingModuleError`](/packages/expo/using-a-module#what-happens-without-the-module-installed) on
the first call or read that needs it. Injecting the service does not throw.

On the web, and in a test that provides no fake, everything reads as offline and unknown:
`connected` is `false`, `type` is `'unknown'`, `reachable` is `null`.

## Working offline

For the common pattern of showing cached data immediately, refreshing when `connected` goes true,
and queuing writes made while offline, see [Working offline](/guide/offline).

## Reference

<!-- api: Network -->
