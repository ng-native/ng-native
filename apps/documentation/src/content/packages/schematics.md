---
title: Angular CLI
summary: ng add for an Angular CLI workspace, with a native app beside the web one that ng serve,
  ng build and ng test run.
---

# Angular CLI

`@ng-native/schematics` adds an Angular Native app to a workspace `ng new` made. The workspace
keeps its web app exactly as it was, and gains a second project, an Expo app in
`projects/native`, that the usual `ng` commands run:

```sh
ng add @ng-native/schematics
ng serve native
```

`ng serve native` starts Metro, the same as `npx expo start` in an app made from the template:
scan the QR code with Expo Go, or press `i` or `a` for a simulator. For an app on its own, without
a workspace around it, [the template](/guide/getting-started) is still the shorter road.

## What it adds

The files are the template's, copied as they are: `src/app/app.ts`, `src/main.ts`,
`src/app/app.test.ts`, `src/app/app.device.ts`, `metro.config.js`, `tsconfig.json` and
`vitest.config.mts`, plus an `app.json` named for the project, a small `package.json` for Expo, and
a `.gitignore` that ignores the `ios/` and `android/` projects `expo prebuild` writes, the
`.angular-native/` Tailwind generates, and the `-actual.png` and `-diff.png` a failed screenshot
comparison writes under `__screenshots__`, as the template's does. The dependencies go in the
workspace's root `package.json`, beside Angular's, and `ng add` installs them. A version the
workspace already has is left alone.

The project's own `package.json` lists every dependency at the root's ranges, because Expo links
only the native modules it names, but nothing installs from it: decline when `expo prebuild` offers
to install packages into the project, or it puts a second React Native beside the root's.

The web app is left as it is, since Metro, not `@angular/build`, builds the native one.

## The targets

| Command                     | What runs                                                       |
| --------------------------- | --------------------------------------------------------------- |
| `ng serve native`           | `expo start`. Takes `--port` and `--clear`.                     |
| `ng build native`           | `expo export`, for every platform, into `dist/native`.          |
| `ng test native`            | `vitest run --project node`: the tests that run in Node.        |
| `ng run native:run-ios`     | `expo run:ios`: a development build on a simulator.             |
| `ng run native:run-android` | `expo run:android`.                                             |
| `ng run native:typecheck`   | `ngc --noEmit`, which checks the templates as well as the code. |
| `ng lint native`            | ESLint, with `--linter=eslint` only.                            |

Each but `lint` is an Expo, Vitest or `ngc` command run in the project's directory, by the package's
three builders, `@ng-native/schematics:expo`, `@ng-native/schematics:vitest` and
`@ng-native/schematics:typecheck`. `lint` is angular-eslint's `@angular-eslint/builder:lint`, given
the project's own `eslint.config.mjs`. They run the copies the workspace installed, with the
terminal attached, so Metro's QR code and keyboard shortcuts work as they do under `npx expo start`.
A plain `ng test` runs the web app's tests and the native app's, since the Angular CLI runs `test`
for every project that has one. A plain `ng build` and `ng serve` still mean the web app.

`ng test native` runs on the package's Vitest builder rather than `@angular/build:unit-test`,
since a native test renders onto the fake Fabric, not a DOM. The Vitest builder's options are `watch`, `filter`
(only the test files whose path contains it) and `project` (only the Vitest project of that name).

The app's `vitest.config.mts` has three projects, as the template's does: `node`, in Node, which
the `test` target runs alone (`"options": { "project": "node" }`), and `ios` and `android`, which
run `src/**/*.device.ts` [inside the app](/packages/testing/in-app-tests) and start Metro, build the
app and open it on a simulator or emulator themselves. `src/app/app.device.ts` is the example: run
`npx vitest --project ios` in the project's folder. The first run builds the app, which needs Xcode
or the Android SDK.

`ng run native:typecheck` loads `metro.config.js` before `ngc`, as the template's `typecheck`
script does, so that once [Tailwind](/packages/tailwind) is added, the sheet `src/main.ts` imports
exists on a fresh checkout. A project without a Metro config runs `ngc` alone.

## macOS and Linux

```sh
ng generate @ng-native/schematics:desktop native
```

This adds macOS and Linux to a native app: `@ng-native/desktop` in the root `package.json`, `macos`
and `linux` in `expo.platforms` with `experiments.outOfTreePlatforms: true` (Expo drops them from
every bundle and export without it, and says nothing), `@ng-native/desktop` among the config
plugins in `app.json`, `/dist/macos` and `/dist/linux` in the project's `.gitignore`, and three
targets on the `expo` builder:

| Command                 | What runs                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ng run native:macos`   | `ng-native-desktop run`: on a Mac, builds the desktop host and opens the app in it.                                           |
| `ng run native:linux`   | `ng-native-desktop run --os linux`: on Linux, the same, in GTK.                                                               |
| `ng run native:package` | `ng-native-desktop package`: the `.app`, `.dmg` or Mac App Store package; on Linux the app folder, `.deb`, `.rpm` or Flatpak. |

The Expo CLI has no `run:macos` or `run:linux`, so the builder runs `ng-native-desktop` from
[`@ng-native/desktop`](/packages/desktop) for these three. `macos` and `linux` load the app from
the dev server `ng serve native` runs, and take `--port` for another one; `linux` runs on Linux
only, and on a Mac it stops and names packaging. `package` makes the machine's own default package;
another format goes to it through the target's `args` in `angular.json`, for instance as a
configuration that `ng run native:package:dmg` runs, with `"args": ["--os", "linux", "--format",
"deb", "--maintainer", "Ada Lovelace <ada@example.com>"]` for a `.deb`:

```json
"package": {
  "builder": "@ng-native/schematics:expo",
  "options": { "command": "package" },
  "configurations": {
    "dmg": { "args": ["--format", "dmg"] }
  }
}
```

An app that has `macos` alone gains `linux`, and running the schematic again changes nothing. It
stops with an error on a project with no `app.json`, which is not an Angular Native app. See
[Build for Linux](/guide/desktop-linux) for the Linux setup.

## iOS and Android

```sh
ng generate @ng-native/schematics:mobile native
```

This adds iOS and Android to a desktop-only app (see [Options](#options)), undoing what
`--desktop-only` left out: `ios` and `android` in `expo.platforms` beside `macos` and `linux`, the
phone
settings a mobile app's `app.json` has (portrait orientation, `ios.supportsTablet`, and
`android.package`, which is the iOS bundle identifier), `expo-status-bar` and `expo-system-ui` in
the root `package.json` and the project's own, whose native modules Expo autolinks, and two targets
on the `expo` builder:

| Command                     | What runs                                    |
| --------------------------- | -------------------------------------------- |
| `ng run native:run-ios`     | `expo run:ios`: the app on the iOS simulator |
| `ng run native:run-android` | `expo run:android`: the Android emulator     |

Both take the `serve` target's port, which `expo run:ios` builds into the app. A setting the app
already has stays as it is, and running the schematic again changes nothing. It leaves the app's
screens, its Vitest projects and its `test` target, which runs `node-macos` and `node-linux`, as
they are. It stops
with an error on a project with no `app.json`, which is not an Angular Native app.

## ng generate

```sh
cd projects/native
ng generate component profile-card
```

Run inside the project, `ng generate component` writes a native component in
`src/app/profile-card`, beside `app.ts`: `<view>` and `<text>` imported from
`@ng-native/components`, and a `profile-card.test.ts` that renders it with `@ng-native/testing`.
Run from a directory inside `src`, it writes there instead. Angular's own component schematic
would write a `<p>`, which is not a native element, and a spec that needs `TestBed` on a DOM.
Everything this package has no schematic for, a service or a pipe, falls through to Angular's,
with its spec turned off in this project, because Angular's specs assume Vitest's globals and a
DOM, and neither is here.

From the workspace root, name the collection. `--project` on its own does not switch collections,
which is the Angular CLI's rule:

```sh
ng generate @ng-native/schematics:component profile-card --project native
```

## Options

`ng add` takes `--name` (the project name and Expo slug, `native` by default), `--directory`
(`projects/<name>` by default), `--bundleIdentifier`, `--linter`, `--desktop-only` and
`--skip-install`.
`--linter=eslint` adds an `eslint.config.mjs` with
[`@ng-native/eslint-plugin`](/packages/eslint-plugin)'s recommended rules, its four packages and a
`lint` target on angular-eslint's builder; `--linter=none`, the default, adds none of them.
`ng generate @ng-native/schematics:application mobile` adds another native app to the same
workspace, and takes `--prefix` for its components' selectors as well.

`--desktop-only` makes a desktop-only app from the desktop template (`@ng-native/template-desktop`):
`macos` and `linux` alone in `expo.platforms`, its sidebar and menu bar starter screen,
`@ng-native/desktop` and `@ng-native/expo` in place of the phone's status bar and system UI
packages, and `macos`, `linux` and `package` targets (see [macOS and Linux](#macos-and-linux)) in
place of `run-ios` and `run-android`. `ng add` and
`ng generate @ng-native/schematics:application` both take it. Its `vitest.config.mts` has four
projects: `node-macos` and `node-linux`, in Node, which its `test` target runs alone through the
Vitest builder's `project` option (`"options": { "project": ["node-macos", "node-linux"] }`), and
`macos` and `linux`, which run `src/**/*.device.ts` inside the app and start Metro and open it.
`src/app/app.device.ts` is the example: run `npx vitest --project macos` (on a Mac) or
`npx vitest --project linux` (in GTK, on Linux or on a Mac in a container) in the project's
folder.

`--bundleIdentifier` is the iOS bundle identifier and Android package in `app.json`. It defaults to
`com.<scope>.<name>`, from the npm scope of the root `package.json`'s name and the app's name with
anything but letters and digits removed, where `expo prebuild` would otherwise use
`com.anonymous.<name>`; a segment that is a Java or Kotlin keyword, such as `native`, gets an `app`
prefix. A given identifier needs two or more dot-separated segments, each
a letter and then letters or digits, none a Java or Kotlin keyword, and the schematic stops with an
error on one that is not.

## When the install fails

`ng add` warns, and leaves the version as it is, when the workspace pins something npm will not
install beside Angular Native:

- **Angular 21 or older.** Every package asks for `^22.0.0`. `ng update @angular/core @angular/cli`
  moves the workspace, web app included.
- **Vitest 3 or older.** `@ng-native/testing`'s Vitest plugin runs on Vitest 4 and 5, so the
  `vitest ^4.0.8` that `ng new` 22.1 writes, and the 5 that 22.2 writes, both work as they are.

pnpm reports these as warnings and installs anyway.

## Upgrading

`ng update @ng-native/schematics` moves every `@ng-native/*` package to the new version, in the
root `package.json` and the native project's own. [Updating an app](/guide/updating) covers the
migrations it runs and what is left to do by hand.
