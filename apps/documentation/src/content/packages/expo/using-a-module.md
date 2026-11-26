---
title: Using a module
summary: Install the Expo module, import its service by entry point, and what happens without it.
---

# Using a module

Installing `@ng-native/expo` itself pulls in no native code at all. You install the actual Expo
module because your app wants that capability, alongside the package that wraps it:

```sh
npm install @ng-native/expo
npm install expo-battery   # only if you're injecting Battery
```

## One entry point per module

**Most of these services have their own entry point** - `@ng-native/expo/battery`,
`@ng-native/expo/haptics`, and so on, one file per module - rather than being re-exported from
the package's own root. That is so that importing haptics never pulls in the video player:

```ts
import { Battery } from '@ng-native/expo/battery';
import { Haptics } from '@ng-native/expo/haptics';
import { Storage } from '@ng-native/expo/async-storage';
import { SecureStorage } from '@ng-native/expo/secure-store';
```

Each name is a type as well as a token, so `inject(Clipboard)` and `private clipboard: Clipboard`
both work. There is nothing to provide or register: injecting a service is the whole setup, and a
service nobody injects is never constructed.

## What happens without the module installed

A service loads its module when it is first injected, not when the file is imported.

Where the module exists for the platform the app is on, a missing one is a mistake with a fix, so
using the service throws a `MissingModuleError` rather than quietly doing nothing. Injecting it does
not throw: a call, or a read of a value only the module knows, does. Whether the feature is there is
the one question that answers instead: `available` reads `false`, and `available()` resolves to
`false`. That covers a package that was never installed, and the more common case of one that was
installed after the app was last built: a development build, and Expo Go, contain only the native
modules they were built with. The message names the module and the commands to run:

```text
expo-haptics is not in this build of the app. Install it with "npx expo install expo-haptics",
then rebuild the app ("npx expo run:ios", or a new EAS build): a development build, and Expo Go,
contain only the native modules they were built with.
```

`MissingModuleError` is exported from `@ng-native/expo`, with a `module` property naming the
package, for an app that wants to catch it and show something of its own.

Where the module cannot exist, the service goes inert instead: an iOS-only module such as
[Sign in with Apple](/packages/expo/apple-sign-in) on Android, a service on the web, and a test in
Node, where there is no platform at all. Code shared across platforms, and a test that provides
no fake, keep working. Inert means reporting nothing rather than throwing: a level of `1`, a
status of `'unknown'`, a method that resolves to `null` or an empty list. Each module's own page
says what its service does in both cases. A few cannot be inert, because an empty answer would be
a wrong one: a [database](/packages/expo/database) or a [player](/packages/expo/player) throws on
the web as well, and [Crypto](/packages/expo/crypto) throws wherever it has no module, since an
empty identifier or hash looks right and is not.

## Faking a module in a test

A test runs in Node, where no native module loads. Most services do nothing there, as off a device;
one with no answer to give without its module, such as `Crypto` or `FileSystem`, throws a
`MissingModuleError`. A service with a `SOURCE` token reads its module through it, so a test
provides a stand-in under that token with the methods the code under test calls, as
[Crypto](/packages/expo/crypto#in-a-test) shows. A database has no token: `openDatabasesWith()`
points `database()` at a stand-in. See [Database](/packages/expo/database#in-a-test).

## A module with no service

An Expo module this package has no service for, such as `expo-contacts`, works as it is in the app.
A static `import * as Contacts from 'expo-contacts'` in a file a test loads fails in Node with
`Flow is not supported`, whether or not the test reads a contact. Load it in a token's factory with
`expoModule()` instead, and inject the token:

```ts
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule } from '@ng-native/expo';

interface NativeContacts {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getContactsAsync(): Promise<{ data: { name: string }[] }>;
}

export const CONTACTS = new InjectionToken<NativeContacts | null>('app.contacts', {
  factory: () =>
    expoModule('expo-contacts', () => require('expo-contacts/legacy') as NativeContacts),
});

@Service()
export class People {
  private readonly native = inject(CONTACTS);

  /** The contacts' names, or none when the user refuses access. */
  async names(): Promise<string[]> {
    const native = this.native;
    if (!native || !(await native.requestPermissionsAsync()).granted) return [];
    return (await native.getContactsAsync()).data.map((contact) => contact.name);
  }
}
```

In a test `expoModule()` answers `null`, so the service is inert. A test that wants an answer
provides one under the token:

```ts
providers: [
  {
    provide: CONTACTS,
    useValue: {
      requestPermissionsAsync: async () => ({ granted: true }),
      getContactsAsync: async () => ({ data: [{ name: 'Ada' }] }),
    },
  },
];
```

## Whether a feature is available

Every service says whether its feature is there as `available`, a `Signal<boolean>` read as
`available()`, in code and in templates alike: `@if (haptics.available())`. Where the answer is
known at once, such as whether the module is in the build, it never changes. Where it is a native
check, such as whether a face or fingerprint is enrolled for
[Biometrics](/packages/expo/biometrics), Sign in with Apple, screen capture or the store review
prompt, it is `false` until the platform answers, no sooner than a turn after it is first read and
sometimes later. A sensor asks as it is created, so its answer can be there before the first read,
and is `false` until then. [Biometrics](/packages/expo/biometrics) asks again each time the
app comes back to the front. The hinge of a
[foldable](/packages/expo/foldable) and the on-device language model follow the feature as it comes
and goes.

A signal is a function, so `if (haptics.available)` is always true. Call it.

Where a service is absent, `available()` is `false` and every call is inert: it answers its return
type's empty value (`[]`, `null`, `false`, an empty string, or nothing) and never throws or hangs.
A permission the user denied is not absence: the call answers empty and the permission says why. A
call throws only on a misconfiguration, such as a module the app installed but the build does not
have. `Crypto` throws where it has no module, since random bytes have no safe empty value;
`LanguageModel`'s generating calls reject with the model's state, and sending to a watch rejects, as
they do on a device where the model or the watch is not ready.

## What is on the bare import

A handful of exports are not bound to one optional module, so they live on `@ng-native/expo`
itself rather than behind an entry point: [`Permission`](/packages/expo/permissions),
`registerExpoView`, `registerExpoViews`, `registerNativeViews` and `registerExpoUiViews` (see
[Native views](/packages/expo/native-views) and [Expo UI](/packages/expo/expo-ui)), and
`nativeState` (also on the Expo UI page).

## Where everything else lives

Every module has its own page, grouped by what it is for, from the [overview](/packages/expo).
For a capability no package covers, [create an Expo module](/guide/native-modules) in Swift and
Kotlin or [use NativeScript](/guide/native-modules/nativescript) to call platform APIs directly from
TypeScript.
