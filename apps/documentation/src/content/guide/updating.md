---
title: Updating an app
summary: Move an app to a new release with nx migrate, ng update or npx @ng-native/migrate, and
  let the migrations change its code.
---

# Updating an app

Every `@ng-native/*` package is released together, at one version. When a release changes
something an app has to change too, such as an import path, it ships a **migration** that makes the
change for you. The migrations live in `@ng-native/migrate`, and all three ways to update run the
same ones:

| The app is in              | Update with                       |
| -------------------------- | --------------------------------- |
| An Nx workspace            | `nx migrate @ng-native/nx@latest` |
| An Angular CLI workspace   | `ng update @ng-native/schematics` |
| A plain Expo app (or both) | `npx @ng-native/migrate@latest`   |

Start from a clean git working tree, so `git diff` shows exactly what the update changed.

## A plain Expo app

An app made with `create-expo-app --template @ng-native/template` has neither Nx nor the Angular
CLI. Run the migrations with `npx`, before installing the new versions:

```sh
npx @ng-native/migrate@latest
npm install
```

It reads the `@ng-native/*` version the app's `package.json` lists, runs every migration newer than
that version, oldest first, and moves the `@ng-native/*` versions in `package.json` to the new
release. It prints each migration it runs, each file it changed (`UPDATE`), and anything left for
you to do (`NOTE`). Run the install it names afterwards.

```sh
npx @ng-native/migrate@latest --dry-run       # print what would change, write nothing
npx @ng-native/migrate@latest --from 0.2.0    # the version the app was on
npx @ng-native/migrate@latest apps/mobile     # an app in another directory
```

If the new versions are already installed, `package.json` already lists them, and the command finds
nothing to migrate. Pass the version the app was on with `--from` to run the migrations since then.

## An Nx workspace

```sh
nx migrate @ng-native/nx@latest
pnpm install
nx migrate --run-migrations
pnpm install
```

The first command moves every `@ng-native/*` package in the root `package.json` and writes the
migrations the update crosses into `migrations.json`, without changing any code yet, so you can
read the list first. `--run-migrations` runs them and prints what is left to do as next steps. See
[Nx](/packages/nx) for the workspace setup.

## An Angular CLI workspace

```sh
ng update @ng-native/schematics
```

`ng update` moves every `@ng-native/*` package in the root `package.json`, installs them, and runs
the migrations the update crosses. What is left to do is printed as a warning. To run the
migrations again for an update already installed, name the versions:

```sh
ng update @ng-native/schematics --migrate-only --from 0.2.0 --to 0.3.0
```

See [Angular CLI](/packages/schematics) for the workspace setup.

## What the migrations do

| Migration                | Runs on           | What it changes                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-app-versions`      | Every update      | Moves the `@ng-native/*` versions in every `package.json` in the workspace, an app's own included, to the new release. A `^` or `~` stays; a `workspace:` or `file:` link and a peer range are left alone.                                                                                                                                                                                                                 |
| `split-store-and-player` | Updating to 0.3.0 | Imports `Storage` from `@ng-native/expo/async-storage`, `SecureStorage` from `@ng-native/expo/secure-store`, `audioPlayer` from `@ng-native/expo/audio` and `videoPlayer` from `@ng-native/expo/video`, which used to come from `@ng-native/expo/store` and `@ng-native/expo/player`. A namespace import, `export *`, `require()`, `import()` or a test's `vi.mock` of the old entry point is left as it was, with a note. |

A migration changes only what it can change safely. Where it finds something it cannot rewrite on
its own, it leaves the file as it was and prints a note saying which file and line to change, and
how. A migration that runs a second time changes nothing.

## What is left to do by hand

- **Install.** Run the install the update prints, so the new versions are in `node_modules`.
- **The notes.** Make each change a `NOTE` line or a printed next step asks for.
- **Rebuild the native app** when the update adds or moves a native module: a development build
  and Expo Go carry only the native modules they were built with. See
  [Deployment](/guide/deployment).
- **Read the changelog** for the release, on the
  [releases page](https://github.com/ng-native/ng-native/releases), for changes no migration covers.
