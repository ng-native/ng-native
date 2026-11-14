---
title: Desktop
summary: The macOS host and the ng-native-desktop command that builds, runs and packages the app.
---

# Desktop

`@ng-native/desktop` is the macOS desktop host: React Native's C++ core and Hermes, mounting an
app's views into AppKit, and the `ng-native-desktop` command that builds the host and runs the app
in it. You install the package and never import it.

## Setup

An app made from the desktop template has it already. To add macOS to an app:

```sh
npx expo install @ng-native/desktop
```

Then, in `app.json`, add `macos` to `expo.platforms`, set `expo.experiments.outOfTreePlatforms` to
`true` (without it Expo drops `macos` from every bundle and export, and says nothing), add
`@ng-native/desktop` to `expo.plugins`, and add two scripts to `package.json`:

```json
{
  "scripts": {
    "macos": "ng-native-desktop run",
    "package": "ng-native-desktop package"
  }
}
```

In an Nx workspace, `nx g @ng-native/nx:desktop <app>` does all of this, and in an Angular CLI
workspace `ng generate @ng-native/schematics:desktop <app>` does. See [Nx](/packages/nx#macos) and
[Angular CLI](/packages/schematics#macos).

## Run the app

```sh
npm start        # the Expo CLI's dev server, in one terminal
npm run macos    # builds the host the first time, then opens the app from the dev server
```

The Expo CLI has no `run:macos`: its `run` commands are a fixed list, so `npm run macos` is
`ng-native-desktop run`. It takes a bundle path or URL in place of the dev server, `--module`,
`--port` and `--universal`.

## Package the app

```sh
npm run package                                   # dist/macos/<name>.app, ad-hoc signed
npm run package -- --format dmg                   # signed, notarised and stapled .dmg
npm run package -- --format dmg --feed-url https://example.com/appcast.xml --sparkle-key <key>
npm run package -- --format mas                   # a sandboxed Mac App Store .pkg
```

A package is a release build, universal for Apple silicon and Intel Macs, for macOS 14 and later.
Packaging needs full Xcode, which compiles the app icon (an image, or an Icon Composer `.icon`);
the Command Line Tools cannot, and the command says so before it builds anything. `--output`
puts the packages somewhere other than `dist/macos`.

- **`app`** is signed ad hoc, for this Mac and for testing. With no `ios.bundleIdentifier` it gets
  one made from the slug.
- **`dmg`** is signed with your Developer ID and the hardened runtime, notarised, and stapled, app
  and disk image both. `--feed-url` embeds Sparkle with that appcast and makes the `.zip` Sparkle
  updates from beside the `.dmg`; only a `dmg` has Sparkle. It needs Sparkle's public EdDSA key,
  which Sparkle checks each update against: `--sparkle-key`, or `NGN_SPARKLE_PUBLIC_KEY`, set to
  what Sparkle's `generate_keys` prints. Sparkle then checks for updates on its own schedule,
  without first asking the user.
- **`mas`** is signed inside the App Sandbox with your provisioning profile, as an installer
  package for App Store Connect. The command names any capability the sandbox forbids, such as
  `spawn` and `paths`, which a sandboxed app cannot use.

A `dmg` or `mas` needs `ios.bundleIdentifier`. Credentials come from the environment, never from
`app.json`:

| Variable                                                              | For                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `NGN_SIGN_IDENTITY`                                                   | The signing identity, for `dmg` and `mas`                      |
| `NGN_NOTARY_PROFILE`                                                  | A `notarytool` keychain profile                                |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`               | Or an App Store Connect API key, for CI                        |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`            | Or an Apple ID                                                 |
| `NGN_INSTALLER_IDENTITY`, `NGN_PROVISIONING_PROFILE`, `APPLE_TEAM_ID` | `mas`: the installer identity, the profile's path and the team |
| `NGN_SPARKLE_PUBLIC_KEY`                                              | `dmg` with `--feed-url`: Sparkle's public EdDSA key            |

A rejected notarisation stops the command with the submission's id, for
`xcrun notarytool log <id>`.

## Config

The macOS build reads what Expo already has a key for from that key, the one the iOS build reads:

| Setting           | Expo key                                                       |
| ----------------- | -------------------------------------------------------------- |
| Bundle identifier | `ios.bundleIdentifier`                                         |
| URL schemes       | `scheme` and `ios.scheme`                                      |
| Icon              | `ios.icon` (an Icon Composer `.icon` or an image), else `icon` |
| Version and build | `version` and `ios.buildNumber`                                |
| Updates server    | `updates.url`                                                  |
| Usage strings     | `ios.infoPlist`, and each `expo-*` plugin's permission option  |

The plugin options hold only what has no Expo key:

```json
[
  "@ng-native/desktop",
  {
    "documentTypes": [{ "name": "Markdown", "extensions": ["md"] }],
    "capabilities": {
      "spawn": [{ "program": "git", "args": ["status", "--porcelain"] }],
      "env": ["HOME"],
      "paths": [{ "path": "~/Projects", "access": "readwrite" }]
    },
    "deny": ["react-native-some-library"]
  }
]
```

- **`documentTypes`** - the files the app opens from Finder, by extension.
- **`capabilities`** - the programs [`Processes.spawn`](/packages/device/processes) may run, the
  environment variables it may read, and paths outside the app's own folders.
- **`deny`** - npm packages whose native code stays out of the desktop build.

Expo runs the plugin whenever it reads the config, so an option that is not valid stops
`expo start`, `expo export` and `ng-native-desktop` with every problem listed.

## Native code

The desktop build finds native code the way Expo's autolinking finds a library's iOS and Android
code, walking the app's dependencies and theirs:

- **A library** opts in through its `expo-module.config.json`: `macos` among its `platforms`, and a
  `macos` entry naming the CMake target its desktop code builds and the folder holding its CMake
  fragment, `desktop` unless it says otherwise.

  ```json
  {
    "platforms": ["apple", "android", "macos"],
    "macos": { "cmakeTarget": "haptics_desktop", "cmakeDir": "desktop" }
  }
  ```

- **The app's own modules** are each `modules/<name>/macos/`, beside `ios/` and `android/`. The
  module's `expo-module.config.json` can name its CMake target the same way.
- **`deny`** in the plugin options keeps a package out, whatever it ships.

`npm run macos` and `npm run package` list the dependencies that have native code for iOS or
Android and none for the desktop: their native modules are absent on macOS, so a service built on
one reports itself unavailable. `expo`, the `expo-*` packages and `@ng-native/*` are not listed,
since the desktop host answers their services itself. `react-native-screens` and
`react-native-safe-area-context` are compiled into the host when the app has them.
