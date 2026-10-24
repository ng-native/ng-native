---
title: NativeScript
summary: Every iOS and Android API, and native views, from TypeScript through NativeScript.
---

# NativeScript

`@ng-native/nativescript` puts [NativeScript](https://nativescript.org)'s runtime behind one
provider, one service and one element. NativeScript makes every iOS SDK class, function, struct and
enum, and every class on the Android classpath, a JavaScript value. With this package an app calls
them from a component, with no Swift, Kotlin or Expo module in between:

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { NativeScript } from '@ng-native/nativescript';

@Component({
  selector: 'app-device-name',
  imports: [Text],
  template: `<text>{{ model }}</text>`,
})
export class DeviceName {
  private readonly native = inject(NativeScript);

  protected readonly model = this.native.call({
    ios: () => UIDevice.currentDevice.model,
    android: () => android.os.Build.MODEL,
  });
}
```

The call is synchronous: it is a JSI call on the JavaScript thread, with no bridge and no promise.

It suits an API no Expo module wraps, or one an app needs a single call of. A capability several
apps share, or one with a fixed surface, is better as an [Expo module](/guide/native-modules), which
is typed once and needs no runtime of its own.

## Setup

NativeScript links a native runtime and generates metadata for the SDKs during the native build, so
it needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/):
`npx expo run:ios` or `npx expo run:android`, not Expo Go.

In an Nx workspace, one generator does all of the setup:

```sh
npx nx g @ng-native/nx:nativescript mobile
```

Anywhere else, install the packages:

```sh
npx expo install @ng-native/nativescript @nativescript/react-native react-native-worklets
npm install --save-dev @nativescript/types-android
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": ["@ng-native/metro", "@ng-native/nativescript"]
  }
}
```

It runs `@nativescript/react-native`'s own config plugin, which adds the runtime to the iOS project
and applies its Gradle script on Android. Options are passed on to it, such as Objective-C pods or
system frameworks the metadata should cover:

```json
["@ng-native/nativescript", { "metadata": { "includePods": ["SomeObjCSDK"] } }]
```

On Android it also sets `nsFilterMetadata=false` in `gradle.properties`, unless the app sets it
there. With filtering on, `@nativescript/react-native` adds keep rules to each minified build
type, and on Expo SDK 58, whose Android Gradle Plugin does not allow that and whose release builds
are minified by default, the build fails with `UnsupportedOperationException` in
`nativescript.gradle`. Without filtering, NativeScript's metadata covers the app's whole classpath
rather than only the classes it uses, so the app is larger; R8 still shrinks the app's own code.

Add the SDKs' types in a declaration file, such as `src/nativescript.d.ts`:

```ts
/// <reference types="@nativescript/react-native/types/ios" />
/// <reference types="@nativescript/types-android" />
```

A reference rather than an entry in `tsconfig.json`'s `types`, which would stop TypeScript including
the `@types` packages it includes without one.

Then provide it, in the providers `mount` is given:

```ts
import { provideNativeScript } from '@ng-native/nativescript';

const app = mount(Number(rootTag), App, getFabricUIManager(), {
  providers: [provideNativeScript()],
  // ...and the rest of the options main.ts already passes.
});
```

Then rebuild the app: `npx expo run:ios`, `npx expo run:android`.

### The Babel config

A worklet that names a native class, such as `UILabel.new()`, needs the worklets Babel plugin's
`strictGlobal` option: without it the plugin reads `UILabel` on the JavaScript thread as the module
loads, before NativeScript is installed, and the app fails as it starts with
`Property 'UILabel' doesn't exist`. [`@ng-native/metro`](/packages/metro) sets it when
`@nativescript/react-native` is installed and the app has no Babel config of its own, so an app
without a `babel.config.js` needs nothing.

An app with its own `babel.config.js` sets it there, and Metro warns once if it is missing:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { worklets: false }]],
    plugins: [['react-native-worklets/plugin', { strictGlobal: true }]],
  };
};
```

`worklets: false` stops the preset adding a second copy of the plugin, without the option.

## Installing it

`provideNativeScript()` installs NativeScript as the injector it is in is created. In the app's
providers that is before the root component is created, so a field initializer can call native
APIs. In a route's `providers` it is as the route is first entered, and the cost of installing is
paid there instead of at launch:

```ts
export const routes: Routes = [
  {
    path: 'studio',
    providers: [provideNativeScript({ frameworks: ['SceneKit'] })],
    loadComponent: () => import('./studio.ts').then((m) => m.Studio),
  },
];
```

Installing takes about 0.4 seconds on iOS in a release build, and 0.7 in a debug build, most of it
NativeScript reading its metadata; on Android about a tenth of a second. Installing again, from a
second provider, does nothing.

`frameworks` loads iOS system frameworks whose classes the metadata describes but the app does not
link, such as SceneKit or MapKit. One that fails to load is reported to Angular's `ErrorHandler`.
Android loads classes from the APK, so the option does nothing there.

## On each platform

On iOS every class, function, constant, protocol, enum and struct in the iOS SDK becomes a global,
`UIDevice` and `CGRectMake` among them. Enum members are globals under
their full C names, `NSTextAlignmentCenter`; the short ones stay on their enum,
`NSTextAlignment.Center`.

On Android the classpath is reached through its packages: `android.os.Build`, `java.lang.System`,
`androidx.*`, and the app's own. A top-level package whose name is already a read-only global is
reached with a `$` in front of it: Expo owns `globalThis.expo`, so the `expo.*` Java packages are
`$expo`.

What runs where differs, and is the subject of
[Calling native APIs](/packages/nativescript/calling-apis).

## Without NativeScript in the build

In Expo Go, or a build made before the package was added, the app still runs. What uses NativeScript
throws an error saying what to install and that the app needs rebuilding: `call()` throws it,
`runOnUI()` rejects with it, and an `<ns-view>` reports it to the `ErrorHandler`. A native class
named outside `call()` fails with `ReferenceError: Property 'UIDevice' doesn't exist`, which says
less, so calls go through `call()`.

## In a test

In Node, where [`@ng-native/testing`](/packages/testing) renders components, there is no
NativeScript. `platform` is `null`, `call()` answers `undefined` without calling anything,
`runOnUI()` resolves to `undefined`, and `<ns-view>` renders as an empty view. A component that
calls native APIs renders and is tested like any other.

A test that needs native answers provides `NativeScript.RUNTIME`, a `NativeScriptRuntime` whose
`runOnUI` runs the worklet in place:

```ts
import { NativeScript, type NativeScriptRuntime } from '@ng-native/nativescript';

const runtime: NativeScriptRuntime = {
  platform: 'ios',
  install: () => {},
  runOnUI: async (worklet, ...args) => worklet(...args),
  loadFramework: () => true,
  nativeViewHandle: () => 'a view',
};

await render(DeviceName, { providers: [{ provide: NativeScript.RUNTIME, useValue: runtime }] });
```

The functions passed to `call()` still name native classes, which do not exist in Node, so a test
that runs them defines the ones they use on `globalThis` first.

## What's in the package

- [`provideNativeScript`](#installing-it): installs the runtime, and loads frameworks.
- [`NativeScript`](/packages/nativescript/calling-apis): `call()` on the JavaScript thread, and
  `runOnUI()` on the UI thread.
- [`<ns-view>`](/packages/nativescript/views): a native view built in TypeScript, in the template.
- [`androidContext()`](/packages/nativescript/calling-apis#on-android): the Activity to build an
  Android view with.
