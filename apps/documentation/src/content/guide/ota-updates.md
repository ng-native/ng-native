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

## On macOS

EAS Update does not update macOS apps. A packaged Mac app takes Expo Updates (protocol 1) from a
server you host, at the `updates.url` in `app.json`: the desktop host downloads the launch asset
and the update's other assets, checks each against the manifest's hash, and, with
`updates.codeSigningCertificate` set, checks the manifest's signature. An update whose launch
crashes is not run again. The [Updates](/packages/expo/updates) service is the same on a Mac:
`check()` and `apply()`, with `enabled` false in development and without an `updates.url`.

A `dmg` packaged with `--feed-url` also embeds Sparkle, which replaces the whole app, native code
included, rather than its bundle: see
[A new version of the whole app](/packages/expo/updates#a-new-version-of-the-whole-app).

## HotCodePush

HotCodePush, the over-the-air (OTA) update service for React Native, Expo, Capacitor and Cordova,
ships its Expo SDK as a config plugin. The plugin wires the native projects at prebuild and the CLI
bundles and uploads the platform you name. An NG Native app needs no change to the SDK: its
JavaScript API is plain functions, and the plugin edits the files `expo prebuild` writes.

### Install

```sh
npm install @hotcodepush/expo-ota-updates @ng-native/expo
npm install --save-dev hotcodepush
```

`@ng-native/expo` loads the SDK in a service below. Install it at the version of your other
`@ng-native` packages, and before the build: it carries native modules, a native module changes
the build's fingerprint, and an update only reaches the builds whose fingerprint it was made for.

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

Then sign in with `npx hotcodepush login`, or set `HOTCODEPUSH_TOKEN` in CI. A release build runs
the CLI, which registers the build and uploads the bundle it embeds, so later updates download only
the files that changed. Signed out, a local build only warns and registers nothing, while a CI
build fails.

Generate a signing key with `npx hotcodepush signing-key create`. It adds the public key to
`hotcodepush.json`, the build embeds it, and from then on the app runs only bundles signed with the
private key. Without a key the app trusts whatever the HotCodePush servers deliver. The private key
lands in `hotcodepush-private-key.pem` in the working directory. Add that file to `.gitignore`
before the next commit and keep it where your CI secrets live, since whoever holds it can sign the
app's updates.

`npx hotcodepush init` does all of this in one step: it installs the package, writes the file, adds
the plugin entry, signs you in and offers to generate the key. Then build in release, since a debug
build takes its JavaScript from Metro and no update:

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

The package's own `SyncResult` type describes the full result, if you import it.

`sync()` runs one cycle, check, download and apply, and resolves a typed result. With the defaults
the SDK runs the same cycle on its own at every start, downloads in the background and applies the
update at the start after that, so the app never restarts under the user's hands. A release marked
mandatory is the exception: by default it applies as soon as it downloads, which restarts the app
and discards unsaved state such as a half-filled form. Set `mandatoryApplyStrategy` to `manual` in
`hotcodepush.json` to apply it yourself at a safe moment. A rollback guard watches the first start
of every update: an update whose bundle does not render in time is rolled back to the one before
it.

### Release

Change something, then release it to the channel, once per platform. The CLI bundles the platform
you name with `expo export:embed`, through the app's own Metro config, so the Angular compilation
runs as in a build, and signs the bundle with the private key:

```sh
npx hotcodepush release create --platform ios --private-key-path hotcodepush-private-key.pem
npx hotcodepush release create --platform android --private-key-path hotcodepush-private-key.pem
```

In CI, put the key's text in `HOTCODEPUSH_SIGNING_KEY`, drop the flag and add `--yes`, since
nothing can answer the confirmation there. An app without a registered key releases without the
key.

The installed app downloads the release at its next start and runs it from the start after that.
The [Expo SDK docs](https://hotcodepush.com/docs/sdks/expo) cover the configuration, the API and
the events. The [demo app](https://github.com/hotcodepush-team/ng-native-ota-updates-demo) is the
template app with the SDK wired in, built on both platforms in CI.
