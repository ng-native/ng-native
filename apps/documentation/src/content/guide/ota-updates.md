---
title: OTA updates
summary: Ship JavaScript and assets without a store release, with expo-updates or HotCodePush.
---

# OTA updates

An over-the-air (OTA) update replaces the JavaScript bundle and the assets of an installed app
without a new store build. Native code stays as it was built, so an update can change anything the
Metro bundle holds: Angular code, templates, styles and images. A change to a native module, a
config plugin or `app.json` still needs a store release.

Two services do this in an NG Native app. Both need `expo prebuild` and a build of your own. Expo Go
cannot run either: it has no HotCodePush module, and it keeps `expo-updates` for loading projects,
with its update API disabled. A development build can preview an EAS update. Pick one service: the
HotCodePush prebuild refuses an app with `expo-updates` enabled, because each decides which bundle
the app runs.

## expo-updates

Expo's own module, served by [EAS Update](https://docs.expo.dev/eas-update/introduction/) or a
server you host. The [Updates](/packages/expo/updates) service wraps it: `check()` downloads an
update and `apply()` restarts the app into it. That page covers the install and the service's
state.

## On macOS and Linux

EAS Update does not update desktop apps. A packaged Mac or Linux app takes Expo Updates (protocol 1)
from a server you host, at the `updates.url` in `app.json`, with `expo-platform` set to `macos` or
`linux`. Each asset is checked against the manifest's hash and, with
`updates.codeSigningCertificate` set, the manifest's signature. An update whose launch crashes
before it has shown its first frame for 10 seconds (or been quit cleanly once its bundle has
loaded) is not run again; a later crash does not roll it back. The [Updates](/packages/expo/updates)
service is the same as on a phone, with `enabled` false in development and without an
`updates.url`. See [Updates](/packages/desktop/packaging#updates) for where the host keeps them.

A `dmg` packaged with `--feed-url` also embeds Sparkle, which replaces the whole app, native code
included, rather than its bundle: see
[A new version of the whole app](/packages/expo/updates#a-new-version-of-the-whole-app).

## HotCodePush

[HotCodePush](https://hotcodepush.com) ships its Expo SDK as a config plugin, which works unchanged
in an NG Native app.

```sh
npm install @hotcodepush/expo-ota-updates @ng-native/expo
npm install --save-dev hotcodepush
npx hotcodepush init
```

`init` writes `hotcodepush.json`, adds the plugin, signs you in and offers to generate a signing
key. Add the plugin after `@ng-native/metro` in `expo.plugins`. Install `@ng-native/expo` before
the build: it carries native modules, which change the build's fingerprint, and an update only
reaches the builds whose fingerprint it was made for. Build in release, since a debug build takes
its JavaScript from Metro:

```sh
npx expo prebuild
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

### Call it from a service

The SDK exports `HotCodePush`, an object of promise-returning functions with no React in its API.
Load it the way [a module with no service](/packages/expo/using-a-module#a-module-with-no-service)
is loaded, through a token whose factory calls `expoModule()`, so the service is inert in a test
in Node and a test can provide a stand-in:

```ts
import { InjectionToken, Service, inject, signal } from '@angular/core';
import { expoModule } from '@ng-native/expo';

interface NativeHotCodePush {
  sync(): Promise<{ status: string }>;
}

export const HOT_CODE_PUSH = new InjectionToken<NativeHotCodePush | null>('app.hotCodePush', {
  factory: () =>
    expoModule(
      '@hotcodepush/expo-ota-updates',
      () =>
        (require('@hotcodepush/expo-ota-updates') as { HotCodePush: NativeHotCodePush })
          .HotCodePush,
    ),
});

@Service()
export class OtaSync {
  private readonly native = inject(HOT_CODE_PUSH);

  readonly lastStatus = signal<string | null>(null);

  async sync(): Promise<void> {
    const result = await this.native?.sync();
    this.lastStatus.set(result?.status ?? null);
  }
}
```

`sync()` runs one check, download and apply cycle. By default the SDK also runs it at every start
and applies an update at the start after that; a release marked mandatory applies as soon as it
downloads, restarting the app, unless `mandatoryApplyStrategy` is `manual`.

### Release

`npx hotcodepush release create --platform ios` (and `android`) bundles the app with
`expo export:embed` through its own Metro config, so the Angular compilation runs as in a build.
The [Expo SDK docs](https://hotcodepush.com/docs/sdks/expo) cover the configuration, the API and
the events. The [demo app](https://github.com/hotcodepush-team/ng-native-ota-updates-demo) is the
template app with the SDK wired in, built on both platforms in CI.
