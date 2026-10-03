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
both work. Each service is one file: a `@Service()` class that reaches its module through an
injected source token - an `InjectionToken` carrying its own factory - so there is nothing to
provide and nothing to register. Injecting it is the whole setup, and a service nobody injects is
never constructed.

## What happens without the module installed

A service reaches for its module when it is first injected, with a `require()` inside a factory
rather than a static import: a file with a static `import ... from 'expo-battery'` would be
unloadable by Node at all - Expo's build output uses extensionless relative imports, and what it
pulls in reaches `react-native`, which is Flow.

Where the module exists for the platform the app is on, a missing one is a mistake with a fix, so
the service throws a `MissingModuleError` rather than quietly doing nothing. That covers a package
that was never installed, and the more common case of one that was installed after the app was
last built: a development build, and Expo Go, contain only the native modules they were built
with. The message names the module and the commands to run:

```text
expo-haptics is not in this build of the app. Install it with "npx expo install expo-haptics",
then rebuild the app ("npx expo run:ios", or a new EAS build): a development build, and Expo Go,
contain only the native modules they were built with.
```

On iOS and Android, a service asks Expo whether the module's native half is in the build before it
evaluates the package's JavaScript. Most Expo packages throw while they are being evaluated when it
is not, and Metro reports a throw there as a fatal error, in place of the `MissingModuleError`.

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

A test runs in Node, where no native module can load, installed or not. Most services do nothing
there, as off a device. One that has no answer to give without its module, `Crypto` and
`FileSystem` among them, throws a `MissingModuleError` that says so. A service with
a `SOURCE` token, `Crypto.SOURCE` or `FileSystem.SOURCE`, reads its module through it, so a test
provides a stand-in with the methods the code under test calls:

```ts
providers: [{ provide: Crypto.SOURCE, useValue: { randomUUID: () => 'test-id' } }];
```

A database has no token: `openDatabasesWith()` points `database()` at a stand-in. See
[Database](/packages/expo/database#in-a-test).

## Whether a feature is available

A service that can say whether its feature is there says it as `available`, in one of three shapes,
by what the answer is like:

- **A getter**, `available`, when the answer is known at once and does not change: whether the
  module is in the build, as for [Haptics](/packages/expo/haptics),
  [Fonts](/packages/expo/fonts) and [Tracking](/packages/expo/tracking).
- **A method that resolves**, `await available()`, when the answer is a fresh native check that can
  change while the app runs: whether a face or fingerprint is enrolled for
  [Biometrics](/packages/expo/biometrics), and likewise for Sign in with Apple, screen capture and
  the store review prompt. Ask it just before offering the feature.
- **A signal**, `available()`, when the feature comes and goes and a template follows it: the hinge
  of a [foldable](/packages/expo/foldable), the on-device language model, a sensor.

## What is on the bare import

A handful of exports are not bound to one optional module, so they live on `@ng-native/expo`
itself rather than behind an entry point: [`Permission`](/packages/expo/permissions),
`registerExpoView`, `registerExpoViews`, `registerNativeViews` and `registerExpoUiViews` (see
[Native views](/packages/expo/native-views) and [Expo UI](/packages/expo/expo-ui)), and
`nativeState` (also on the Expo UI page).

## Where everything else lives

Every module has its own page, grouped by what it is for, from the [overview](/packages/expo).
For a capability no package covers, [write a native module](/guide/native-modules) of your own.
