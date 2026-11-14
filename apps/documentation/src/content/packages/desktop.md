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
