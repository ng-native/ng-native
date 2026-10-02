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

```sh
npm install -g eas-cli
eas login
eas build:configure
```

`eas build:configure` writes `eas.json`, with three profiles:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

`distribution: "internal"` permits direct-link installation without a store or a paid Apple
developer account for testing. `developmentClient: true` installs `expo-dev-client` and enables
Metro. Omit it for `preview` and `production` release builds. `autoIncrement` increases the build
number and version code per build to prevent duplicate submissions.

```sh
eas build --platform ios --profile development
eas build --platform android --profile preview
```

EAS Build uses Expo's machines by default. `--local` produces the same artifact locally and requires
the native toolchain used by `expo run`. Use it when Expo's build servers are unreachable or policy
prohibits sending source off the machine.

### Signing

On the first platform build, cloud builds create and store an Apple distribution certificate and
provisioning profile or an Android upload keystore, then reuse them. Manage them with
`eas credentials`. Local builds use the machine's Xcode or Android Studio signing configuration.

## Installing on a device

Install **internal** development or preview builds through their device link or
[Expo Orbit](https://expo.dev/orbit), which also installs from the build page. iOS devices must be
registered to the signing Apple developer account; add them with `eas device:create`. Android APKs
install on any device that permits them.

Submit **production** builds, then use TestFlight or the Play Console's internal testing track to
install them before public release.

## Submit to a store

```sh
eas submit --platform ios
eas submit --platform android
```

These commands submit the profile's latest build by default; use `--path` for another binary.
iOS requires an App Store Connect API key or Apple ID and uploads to App Store Connect, appearing
in TestFlight in ten to fifteen minutes. Android requires a Google Play service account key and
uploads to the track selected in `eas.json` or on the command line.

For screenshots, review information and first submissions, see Expo's guides:
[Submit to the Apple App Store](https://docs.expo.dev/submit/ios/) and
[Submit to the Google Play Store](https://docs.expo.dev/submit/android/).

## What a release build strips

The Metro preset replaces `ngDevMode` with `false` in minified bundles, including release and
preview builds. The minifier removes Angular's dev-mode assertions, error strings and
`setClassMetadata` calls as dead code. See [Metro](/packages/metro) for other build-time processing.
Development builds remain unminified, larger and slower.
