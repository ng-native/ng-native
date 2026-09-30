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
import { Storage, SecureStorage } from '@ng-native/expo/store';
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

## What is on the bare import

A handful of exports are not bound to one optional module, so they live on `@ng-native/expo`
itself rather than behind an entry point: [`Permission`](/packages/expo/permissions),
`registerExpoView`, `registerExpoViews`, `registerNativeViews` and `registerExpoUiViews` (see
[Native views](/packages/expo/native-views) and [Expo UI](/packages/expo/expo-ui)), and
`nativeState` (also on the Expo UI page).

## Where everything else lives

Every module has its own page, grouped by what it is for, from the [overview](/packages/expo).
For a capability no package covers, [write a native module](/guide/native-modules) of your own.
