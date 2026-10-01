---
title: Storage
summary: A persisted value as a two-way signal, backed by AsyncStorage or the keychain.
---

# Storage

`Storage` and `SecureStorage` bind a key to a value that reads back once and writes through
whenever it is set. Both wrap APIs that are already plain promises with no React in them, so what
is worth having is not a wrapper but a binding.

## Install

```sh
npx expo install @react-native-async-storage/async-storage expo-secure-store
```

```ts
import { Storage } from '@ng-native/expo/async-storage';
import { SecureStorage } from '@ng-native/expo/secure-store';
```

Install only the one an app needs: `Storage` needs
`@react-native-async-storage/async-storage`, `SecureStorage` needs `expo-secure-store`. Each has its
own entry point, so an app bundles with only its own module installed. `Store`, the class both are,
and `NativeStore` come from `@ng-native/expo/store`.

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Storage } from '@ng-native/expo/async-storage';

@Component({
  selector: 'app-settings',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="toggle()">
      <text>Theme: {{ theme() }}</text>
    </pressable>
  `,
})
export class Settings {
  private readonly store = inject(Storage);
  protected readonly theme = this.store.signal<'light' | 'dark'>('theme', 'light');

  protected toggle(): void {
    this.theme.set(this.theme() === 'light' ? 'dark' : 'light');
  }
}
```

Reading `theme()` is reading the preference. Calling `theme.set('dark')` persists it: there is
nothing else to call.

## `signal(key, initial)`

Starts at `initial` and stays there until the read comes back, which is one turn away at best -
unless the platform can answer synchronously (`SecureStorage` can, `Storage` cannot), in which
case `initial` is never shown at all. The same key always returns the same `WritableSignal`, so
two components binding to `theme` stay in step, and a value `set` before the read returns is not
undone by it: a write during startup wins the race against whatever was stored before.

An `update` before the read returns is a change to what is stored, not a replacement for it. It
shows at once, applied to what is known so far, and once the read is back it is applied again to
the stored value and that is written: `notes.update((list) => [...list, note])` during startup adds
a note to the stored ones rather than leaving that note alone on the disk. Updates after a `set`
apply to what was set.

Everything is JSON underneath, because both native stores hold strings only, and a store that
silently held `"[object Object]"` would be worse than one that held nothing. A value that fails to
parse - written by an older version of the app, say - is treated as absent, so the caller's own
`initial` is what comes back rather than a thrown error. A stored `null` is not that: it is valid
JSON, so a `signal<string | null>('choice', 'fallback')` whose stored value is `null` reads back
`null`, not `'fallback'`.

## `remove(key)`

Forgets a key, in the native store and in the signal bound to it. The bound signal goes back to the
`initial` it was first asked for with, and stays the one signal for that key, so a later
`signal(key, somethingElse)` returns that same signal still holding the first `initial`. A read of
the key that was still in flight when `remove()` was called does not bring the old value back.

The returned promise rejects if the platform could not remove the key, and the failure is also
reported on `error`.

## `ready`

A signal: true once every key asked for so far has been read back, and false while any read is
still outstanding. Asking for a new key sends it back to `false` until that read returns. Before
any key has been asked for there is nothing to wait for, so it is `true`. Most templates do not
need it: the signal from `signal()` already shows `initial` until its read is back.

A read that fails still counts as read back, so `ready` does not hang on a broken store: the signal
keeps its `initial` and the failure is on `error`.

## When the platform fails

Reads and writes can fail on a device: a full disk, a keychain that is locked or refuses the value.
None of these become unhandled promise rejections. Instead:

- **`error`** is a signal holding the most recent read or write failure as an `Error`, or `null`
  while none has happened. A write through `set()` has no promise to reject, so this is where it
  is reported. The signal itself keeps the value the app set, whether or not it reached the disk.
- **`flush()`** waits for every write sent so far, and rejects with the first write that failed
  since the previous `flush()`, including one that failed before the call. Each failure rejects
  one flush only, so the next `flush()` after it resolves unless another write fails. Await it
  where the app has to know a value was persisted, such as before signing out.
- **`remove(key)`** rejects with its own failure.

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Storage } from '@ng-native/expo/async-storage';

@Component({
  selector: 'app-draft',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="save()">
      <text>Save</text>
    </pressable>
    @if (store.error(); as error) {
      <text>Could not save: {{ error.message }}</text>
    }
  `,
})
export class Draft {
  protected readonly store = inject(Storage);
  protected readonly draft = this.store.signal('draft', '');

  protected async save(): Promise<void> {
    this.draft.set('Dear diary');
    // Rejects if the write did not reach the disk; the message is on error() either way.
    await this.store.flush().catch(() => {});
  }
}
```

## `Storage` versus `SecureStorage`

Two services rather than one, because the difference should be visible at the injection site
rather than buried in an option.

- **`Storage`** is a plain key-value file: bigger, faster, and readable by anyone with the device
  unlocked. Use it for preferences and anything else that is not a secret.
- **`SecureStorage`** is the keychain on iOS and the Android keystore: small values, an async
  write, and an undocumented but real size limit. Use it for tokens and anything that should not
  survive a device backup unencrypted.

## Without the module

On iOS and Android, a missing `@react-native-async-storage/async-storage` or `expo-secure-store` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the store first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, every read resolves to `null` and every write is dropped silently: `signal()` stays at `initial`
forever, `ready` still becomes `true`, `error` stays `null` and `flush()` resolves. Nothing
throws.

## Working offline

`Storage` is the right cache for one value - a preference, a "last synced at" timestamp - not a
list. For a list, see [Database](/packages/expo/database) instead. Either way, see
[Working offline](/guide/offline) for the pattern: show the cache immediately, refresh when there
is a connection, fall back to the cache offline.
