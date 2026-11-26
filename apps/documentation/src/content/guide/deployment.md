---
title: Deployment
summary: Development and release builds, signing, EAS Build and local builds, and store submission.
---

# Deployment

[Getting started](/guide/getting-started) uses Expo Go, which covers most development. To include
your own native code, build an app for a physical device and eventual App Store or Google Play
distribution.

- A **development build** includes Expo's launcher, fast refresh and dev menu. Use it for native
  modules or dependency patches absent from Expo Go.
- A **preview build** compiles in release mode for device testing without store submission.
- A **release build** is ready for submission: minified, without dev tools or Angular dev-mode
  assertions. See "What a release build strips" below.

## Configure the app

All builds read `app.json`. The template supports Expo Go; native builds also need reverse-DNS
iOS bundle and Android package identifiers. Both become permanent after shipping:

```json
{
  "expo": {
    "name": "My App",
    "slug": "my-app",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.example.myapp"
    },
    "android": {
      "package": "com.example.myapp"
    }
  }
}
```

`version` is the store's human-readable version. iOS build numbers and Android version codes are
separate build-time values. EAS Build increments them when a profile sets `autoIncrement`.

The template has no `android/` or `ios/` folder. `npx expo run:ios`, `npx expo run:android` and EAS
Build generate native projects from `app.json` using `expo prebuild` before compiling. Config
changes take effect on the next build without manual syncing.

## Install `expo-dev-client` for a development build

Install the package required for development builds, beyond Expo Go:

```sh
npx expo install expo-dev-client
```

## Build

### Locally

```sh
npx expo run:ios
npx expo run:android
```

These commands require Xcode or Android Studio, compile development builds locally and install on
a connected device or simulator. Add `--configuration Release` (iOS) or `--variant release`
(Android) for a local release build with no dev tools or Metro connection, the closest thing
locally to what a store submission runs.

### With EAS Build

[EAS Build](https://docs.expo.dev/build/introduction/) builds on Expo's machines, or locally with
`--local`, and manages signing credentials; nothing in it is specific to Angular Native:

```sh
npm install -g eas-cli
eas build:configure
eas build --platform ios --profile development
```

Install internal builds through their link or [Expo Orbit](https://expo.dev/orbit), and submit a
production build with `eas submit`; see Expo's guides to
[submitting to the App Store](https://docs.expo.dev/submit/ios/) and
[to Google Play](https://docs.expo.dev/submit/android/).

## macOS

EAS Build does not build macOS apps. A Mac app is a release build packaged on a Mac by the
[desktop host](/packages/desktop)'s command, universal for Apple silicon and Intel Macs, for
macOS 14 and later:

```sh
npm run package                     # dist/macos/<name>.app, signed ad hoc, for this Mac
npm run package -- --format dmg     # Developer ID signed, notarised and stapled, to download
npm run package -- --format mas     # a sandboxed installer package for App Store Connect
```

Packaging needs full Xcode, which compiles the app icon. A `dmg` or `mas` needs
`ios.bundleIdentifier`, and takes its signing identity, notary credentials and provisioning profile
from environment variables, never from `app.json`.
[Package the app](/packages/desktop#package-the-app) lists them, and
[Package in GitHub Actions](/guide/desktop-github-actions) builds, signs and notarises on every
push. `eas submit` has no macOS target: upload a `mas` package with Apple's Transporter app.

## What a release build strips

The Metro preset replaces `ngDevMode` with `false` in minified bundles, including release and
preview builds. The minifier removes Angular's dev-mode assertions, error strings and
`setClassMetadata` calls as dead code. See [Metro](/packages/metro) for other build-time processing.
Development builds remain unminified, larger and slower.
