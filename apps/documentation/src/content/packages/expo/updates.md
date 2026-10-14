---
title: Updates
summary: Checking for and downloading an OTA update, and applying it on the app's own terms.
---

# Updates

`Updates` checks and downloads an OTA update in one call, wired to `expo-updates`. The awkward
part is not checking or downloading - both are plain promises - it is that applying one **restarts
the app**, so the shape that matters is: know one is ready, and let the app choose a moment the
user will not lose anything at.

## Install

```sh
npx expo install expo-updates
```

```ts
import { Updates } from '@ng-native/expo/updates';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Updates } from '@ng-native/expo/updates';

@Component({
  selector: 'app-root',
  template: ``,
})
export class Root {
  private readonly updates = inject(Updates);

  // On foreground, where a restart costs the user nothing.
  protected async refresh(): Promise<void> {
    if (await this.updates.check()) await this.updates.apply();
  }
}
```

## `check()`

Checks for an update and downloads it if there is one, resolving to whether an update is now
waiting. One method rather than two, because there is nothing useful an app can do between
checking and downloading: an app that checks without downloading has learned something it cannot
act on. While it runs, `state()` moves through `'checking'` then `'downloading'`; a failure at
either step lands in `error()` rather than throwing, and the next check that succeeds clears it.

Call it on every foreground. Once an update is downloaded it stays waiting until `apply()`: a later
check that finds nothing new, or fails because the device is offline, still resolves `true` and
leaves `state()` at `'ready'`. A later check that finds a newer update downloads that one instead.

## `apply()`

Restarts the app into the downloaded update. Only does anything when `ready()` is `true` -
call it after `check()` resolves `true`, or after reading `ready()`. **This restarts the app**,
which is why nothing here does it automatically: the moment to do it is one the app knows and this
does not - not mid-form, not mid-upload, usually on next foreground.

## State

- **`state`** - `'idle'`, `'checking'`, `'downloading'`, `'ready'` or `'error'`. A check that
  fails with an update already downloaded settles on `'ready'`, not `'error'`.
- **`ready`** - `true` once an update is downloaded, including while a later check runs and after
  one fails. The only time `apply()` does anything.
- **`error`** - whatever the last `check()` caught, or `null` once a check succeeds.
- **`enabled`** - whether updates are enabled at all. **False in development and in Expo Go**,
  where the bundle comes from Metro rather than a published update. An app should hide an "update
  available" banner here rather than show one that can never resolve; `check()` itself is a no-op
  and resolves `false` when this is false, so it is safe to call unconditionally.

## Without the module

On iOS and Android, a missing `expo-updates` - never installed, or installed without the app being
rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of a
value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `enabled` is `false` and `check()` resolves `false`
without doing anything, the same behavior as running in Expo Go. `apply()` does nothing, since
`ready()` can never become `true`.

## Reference

<!-- api: Updates -->
