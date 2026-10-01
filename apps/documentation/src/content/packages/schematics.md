---
title: Angular CLI
summary: ng add for an Angular CLI workspace, with a native app beside the web one that ng serve, ng build and ng test run.
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
`src/app/app.test.ts`, `metro.config.js`, `tsconfig.json` and `vitest.config.mts`, plus an `app.json` named for the
project, a small `package.json` for Expo, and a `.gitignore` that ignores the `ios/` and
`android/` projects `expo prebuild` writes and the `.angular-native/` Tailwind generates, as the
template's does. The dependencies go in the workspace's root
`package.json`, beside Angular's, and `ng add` installs them. A version the workspace already has
is left alone.

The project's own `package.json` is never installed from. Expo reads `main` from it to find the
entry file, and it also lists every dependency the app has at the root's ranges. Expo links the
native modules that file names and no others, and `expo prebuild`, the first step of
`ng run native:run-ios`, adds `expo`, `react` or `react-native` if it does not find them there and
then offers to install them into the project. Accepting would put a second React Native beside
the root's.

It adds the app beside the web one rather than converting it because there is nothing to convert.
`@angular/build` has no native target: Metro builds an Angular Native app, through the transform
in [Metro](/packages/metro), and the project's `angular.json` entry is what connects that to `ng`.

## The targets

| Command                     | What runs                                                        |
| --------------------------- | ---------------------------------------------------------------- |
| `ng serve native`           | `expo start`. Takes `--port` and `--clear`.                      |
| `ng build native`           | `expo export`, for every platform, into `dist/native`.           |
| `ng test native`            | `vitest run`, through [`@ng-native/testing`](/packages/testing). |
| `ng run native:run-ios`     | `expo run:ios`: a development build on a simulator.              |
| `ng run native:run-android` | `expo run:android`.                                              |

Each is an Expo or Vitest command run in the project's directory, by the package's two builders,
`@ng-native/schematics:expo` and `@ng-native/schematics:vitest`. They run the copies the workspace
installed, with the terminal attached, so Metro's QR code and keyboard shortcuts work as they do
under `npx expo start`. A plain `ng test` runs the web app's tests and the native app's, since the
Angular CLI runs `test` for every project that has one. A plain `ng build` and `ng serve` still mean
the web app.

`ng test native` does not use `@angular/build:unit-test`. That builder compiles tests with the web
build and runs them against a DOM, and a native test renders onto the fake Fabric instead,
compiled by the same transform Metro uses.

## ng generate

```sh
cd projects/native
ng generate component profile-card
```

Run inside the project, `ng generate component` writes a native component: `<view>` and `<text>`
imported from `@ng-native/components`, and a `profile-card.test.ts` that renders it with
`@ng-native/testing`. Angular's own component schematic would write a `<p>`, which is not a native
element, and a spec that needs `TestBed` on a DOM. Everything this package has no schematic for,
a service or a pipe, falls through to Angular's, with its spec turned off in this project, because
Angular's specs assume Vitest's globals and a DOM, and neither is here.

From the workspace root, name the collection. `--project` on its own does not switch collections,
which is the Angular CLI's rule:

```sh
ng generate @ng-native/schematics:component profile-card --project native
```

## Options

`ng add` takes `--name` (the project name and Expo slug, `native` by default), `--directory`
(`projects/<name>` by default) and `--skip-install`. `ng generate @ng-native/schematics:application
mobile` adds another native app to the same workspace, and takes `--prefix` for its components'
selectors as well.

## When the install fails

`ng add` warns, and leaves the version as it is, when the workspace pins something npm will not
install beside Angular Native:

- **Angular 21 or older.** Every package asks for `^22.0.0`. `ng update @angular/core @angular/cli`
  moves the workspace, web app included.
- **Vitest 3 or older.** `@ng-native/testing`'s Vitest plugin runs on Vitest 4 and 5, so the
  `vitest ^4.0.8` that `ng new` 22.1 writes, and the 5 that 22.2 writes, both work as they are.

pnpm reports these as warnings and installs anyway.

## Upgrading

`ng update @ng-native/schematics` moves every `@ng-native/*` package the root `package.json` lists
to the new version with it, since they are released together. It then runs `sync-app-versions`,
which moves the same packages in the native project's own `package.json`, the list Expo links
native modules from, keeping a `^` or `~`. Any other migration the update crosses runs beside it;
they come from `@ng-native/migrate`, and [Updating an app](/guide/updating) lists what each does
and what is left to do by hand.
