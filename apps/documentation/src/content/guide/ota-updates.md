---
title: OTA updates
summary: Ship JavaScript and asset changes to installed apps without a store release, with expo-updates or HotCodePush.
---

# OTA updates

An over-the-air (OTA) update replaces the JavaScript bundle and the assets of an installed app
without a new store build. Native code stays as it was built, so an update can change anything the
Metro bundle holds: Angular code, templates, styles and images. A change to a native module, a
config plugin or `app.json` still needs a store release.

Two services do this in an NG Native app. Both run on `expo prebuild` and a build of your own, a
development build or a release build, since Expo Go carries neither native module. Pick one: the
HotCodePush prebuild refuses an app with `expo-updates` enabled, because each decides which bundle
the app runs.

## expo-updates

Expo's own module, served by [EAS Update](https://docs.expo.dev/eas-update/introduction/) or a
server you host. The [Updates](/packages/expo/updates) service wraps it: `check()` downloads an
update and `apply()` restarts the app into it. That page covers the install and the service's
state.

## HotCodePush

HotCodePush, the over-the-air (OTA) update service for React Native, Expo, Capacitor and Cordova,
ships its Expo SDK as a config plugin. The plugin wires the native projects at prebuild and the CLI
bundles and uploads each platform. An NG Native app needs no change to the SDK: its JavaScript API
is plain functions, and the plugin edits the files `expo prebuild` writes.

### Install

```sh
npm install @hotcodepush/expo-ota-updates
npm install --save-dev hotcodepush
```

Add the plugin after `@ng-native/metro`:

```json
{
  "expo": {
    "plugins": ["@ng-native/metro", "@hotcodepush/expo-ota-updates"]
  }
}
```

Add a `hotcodepush.json` next to `app.json`, with the app id from the
[console](https://console.hotcodepush.com) and the channel this build follows:

```json
{
  "appId": "4f2b7c9e-8d31-4a6e-9b0f-2c5d7e8a1b34",
  "channel": "production"
}
```

`npx hotcodepush init` does the same in one step: it installs the package, writes the file, adds the
plugin entry and signs you in. Then build in release, since a debug build takes its JavaScript from
Metro and no update:

```sh
npx expo prebuild
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

### Call it from a service

The SDK exports `HotCodePush`, an object of promise-returning functions with no React in its API.
Load it the way [a module with no service](/packages/expo/using-a-module#a-module-with-no-service)
is loaded, through a token whose factory calls `require()`, so a test in Node can provide a
stand-in:

```ts
import { InjectionToken, Service, inject, signal } from '@angular/core';
import type { HotCodePush, SyncResult } from '@hotcodepush/expo-ota-updates';

export const HOT_CODE_PUSH = new InjectionToken<HotCodePush>('app.hotCodePush', {
  factory: () => {
    const sdk = require('@hotcodepush/expo-ota-updates') as { HotCodePush: HotCodePush };
    return sdk.HotCodePush;
  },
});

@Service()
export class Updates {
  private readonly api = inject(HOT_CODE_PUSH);

  readonly lastSync = signal<SyncResult | null>(null);

  async sync(): Promise<void> {
    this.lastSync.set(await this.api.sync());
  }
}
```

`sync()` runs one cycle, check, download and apply, and resolves a typed result. With the defaults
the SDK runs the same cycle on its own at every start, downloads in the background and applies the
update at the next start, so the app never restarts under the user's hands. A rollback guard watches
the first start of every update: an update whose bundle does not render in time is rolled back to
the one before it.

### Release

Change something, then release it to the channel. The CLI bundles each platform with
`expo export:embed`, through the app's own Metro config, so the Angular compilation runs as in a
build:

```sh
npx hotcodepush release create
```

The installed app applies the release at its next start. The
[Expo SDK docs](https://hotcodepush.com/docs/expo) cover the configuration, the API and the events.
The [demo app](https://github.com/hotcodepush-team/ng-native-ota-updates-demo) is the template app
with the SDK wired in, built on both platforms in CI.
