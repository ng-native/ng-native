---
title: Network
summary: Connection type and a reachability estimate, as signals - not proof a request will land.
---

# Network

`Network` exposes the platform's connection and internet-reachability estimates. Handle request
failures separately to determine whether your server is reachable. `connected` is whether there is
a connection of any kind; `reachable` forwards the platform's own `isInternetReachable` estimate,
which on iOS is the same value as `connected` and is not the result of probing your server or
anything else. Treat `reachable` as a signal worth branching an offline banner on, not as
confirmation that a request will succeed - a `try`/`catch` around the request itself is what
actually knows that.

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

On iOS and Android, a missing `expo-network` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, everything reads as offline and unknown:
`connected` is `false`, `type` is `'unknown'`, `reachable` is `null`.

## Working offline

For the common pattern of showing cached data immediately, refreshing when `connected` goes true,
and queuing writes made while offline, see [Working offline](/guide/offline).

## Reference

<!-- api: Network -->
