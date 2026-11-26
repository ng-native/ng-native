---
title: Nx
summary: nx add, and app, library and component generators for an Nx workspace, with Expo's
  targets inferred by @nx/expo's plugin.
---

# Nx

`@ng-native/nx` adds an Angular Native app to an Nx workspace, as a project like any other:

```sh
nx add @ng-native/nx
nx g @ng-native/nx:app apps/mobile
nx start mobile
```

`nx start` runs Metro, the same as `npx expo start` in an app made from the template. The app can
import the workspace's Angular libraries, and they are compiled ahead of time into its bundle with
the rest of its code. In a workspace with package-manager workspaces and a scoped root package, as
the TypeScript preset has, each project is named for the scope the way Nx names its own:
`nx start @org/mobile`, and `@org/ui` for a library, in the commands below as well. `@org` stands
for the workspace's own scope, the part before `/` in the `name` of its root `package.json`:
`create-nx-workspace acme --preset=ts` names it `@acme/source`, so the app is `@acme/mobile`.
`nx show projects` lists the names.

## What nx add does

It adds `@nx/expo` at the workspace's own Nx version and registers its plugin in `nx.json`, which
infers an Expo project's targets from its `app.json`, `metro.config.js` and `package.json`. It does
not run `@nx/expo:init`, which installs an Expo SDK older than an Angular Native app needs.

At the workspace root it adds, at the app's versions: `react-dom` and `@expo/cli`, or with
package-manager workspaces `expo`, `react` and `react-native` in place of `@expo/cli`; Babel 7's
`@babel/runtime` and `@babel/core`; and `@expo/metro`. Keep the root's `expo`, `react` and
`react-native` in step with the app's when upgrading it.

In a pnpm workspace it sets `@parcel/watcher` and `unrs-resolver` to `false` under `allowBuilds` in
`pnpm-workspace.yaml`, so pnpm 11 does not stop the install with `ERR_PNPM_IGNORED_BUILDS`. A
decision the workspace already made stays, and an `allowBuilds` written as a flow mapping is left as
it is, with a warning naming the two to decide by hand.

## The targets

| Command                 | From           | What runs                                                      |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `nx start mobile`       | `project.json` | `expo start`, and `serve` likewise                             |
| `nx run mobile:run-ios` | `@nx/expo`     | `expo run:ios`, and `run-android` likewise                     |
| `nx export mobile`      | `@nx/expo`     | `expo export`; `--platform ios` for one platform               |
| `nx prebuild mobile`    | `@nx/expo`     | `expo prebuild`                                                |
| `nx build mobile`       | `@nx/expo`     | an EAS build, on Expo's machines                               |
| `nx test mobile`        | `project.json` | `vitest run --project node`, the tests that run in Node        |
| `nx typecheck mobile`   | `project.json` | `ngc --noEmit`, which checks the templates as well as the code |
| `nx lint mobile`        | `project.json` | `eslint .`, with `--linter=eslint` only                        |

`typecheck`, `test` and `start` are written in `project.json`; `@nx/expo` does not provide the
first two. `test` runs Vitest once rather than watching. `serve` runs `expo start` as well, since
the app has no web platform. On Nx 23, `nx prebuild` and `nx build` print a deprecation notice from
`@nx/expo`'s executors. `typecheck` loads `metro.config.js` before `ngc`, so that once
[Tailwind](/packages/tailwind) is added the sheet `src/main.ts` imports exists on a fresh checkout,
and declares `.angular-native/` as its output, so a cache hit restores the sheet too.

Where the app reaches its libraries through the package manager's links, the TypeScript preset's
layout, `typecheck` reads `tsconfig.typecheck.json`, which maps every `@ng-native` package to the
app's own copy. Without it, `ngc` can stop at `NG3004: Unable to import symbol` when pnpm gives a
library a copy of its own, as installing `react-native-reanimated` or
`react-native-gesture-handler` can cause. An app without the file adds it by hand:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@ng-native/*": ["./node_modules/@ng-native/*"],
      "@ng-native/components/*": ["./node_modules/@ng-native/components/dist/*"],
      "@ng-native/expo/*": ["./node_modules/@ng-native/expo/dist/*"],
      "@ng-native/platform/*": ["./node_modules/@ng-native/platform/dist/*"],
      "@ng-native/web/*": ["./node_modules/@ng-native/web/dist/*"]
    }
  }
}
```

with `node metro.config.js && ngc -p tsconfig.typecheck.json --noEmit` as the `typecheck` target's
command.

Each app gets a Metro port of its own, so `nx run-many -t start` runs several side by side. The
first Expo app uses 8081; each later one takes the lowest port no other app uses
(`expo start --port 8082`), which Expo Go opens at `exp://127.0.0.1:8082`, and its `run-ios` and
`run-android` pass the same port.

## The files

The app is the template's: `src/app/app.ts`, `src/main.ts`, `src/app/app.test.ts` and
`src/app/app.device.ts` as they are, and an `app.json` named for the project. Its `app.json` names
`ios` and `android` as the platforms, because Expo adds `web` whenever `react-dom` resolves, and Nx
always installs one. Its `.gitignore` is the template's, as
[an Angular CLI app's](/packages/schematics#what-it-adds) is. Three files differ,
each because of something Nx does:

- **`metro.config.js`** applies the preset, and the template's `withDeviceTests` around it, around
  `withNxMetro`, from `@nx/expo`, which resolves the workspace's libraries and watches them.
  Without it, Metro cannot follow a tsconfig path alias and reports `Cannot resolve @org/ui`. The
  preset goes on the outside so its resolver can wrap Nx's: a library written for TypeScript's
  module resolution imports `./lib/ui.js` for a `ui.ts`, and the preset resolves that to the `.ts`
  file, as TypeScript does.
- **`tsconfig.json`**, in a workspace with a `tsconfig.base.json`, extends it after Expo's, which
  is where the path aliases are, and puts back the Expo settings the workspace's base overrides,
  `noPropertyAccessFromIndexSignature` included: `src/main.ts` reads
  `process.env.EXPO_PUBLIC_DEVICE_TESTS` with a dot, the only form Expo's Babel preset inlines.
  With package-manager workspaces it does so only when that file has a `paths` list: the
  TypeScript preset's has none, and its libraries are linked as packages instead.
- **`vitest.config.mts`** sets `resolve: { tsconfigPaths: true }` in each Node project, in a
  workspace with path aliases, since Vitest does not read them from tsconfig either, and adds Vite
  8 for it if the workspace has no Vite and no Vitest older than 4.1. In a workspace whose Vite is
  older than 8, or whose Vitest is older than 4.1 (it runs on its own Vite 6 or 7, whatever Vite
  the workspace lists), which cannot resolve them itself, it adds `tsconfigPaths()` from
  `vite-tsconfig-paths` instead, as Nx 24 does for its own Vite configs, and adds Vite at the
  range `@ng-native/testing` peers on if there is none. The app adds them at once rather than when
  a library needs them, since a library generated after the app is the usual case.

Its `vitest.config.mts` has the template's `node`, `ios` and `android` projects, which `nx test`
and `npx vitest --project ios` run as [the Angular CLI's targets](/packages/schematics#the-targets)
describe.

## Where the dependencies go

With package-manager workspaces, Nx's default, the app is a workspace package that lists its own
dependencies, and the generator adds a workspace glob for its directory when none covers it. In an
integrated workspace they go in the root `package.json`. A version already there is left alone, and
a workspace that saves exact versions gets exact versions.

## Native modules a library imports

Expo links only the native modules in the app's dependency tree. In an integrated workspace the
app imports its libraries through path aliases, so a native module a library imports is missing
from a development or release build unless the app lists it. Expo Go has the SDK's modules built in,
so there the gap shows only for a module from outside the SDK. A library that is a workspace package
the app lists has its `dependencies` and required peers linked, and not its `devDependencies` or
optional peers.

The generator registers `@ng-native/nx:sync-native-modules`, a sync generator, on the app's
`start`, `export` and `prebuild` targets. Before any of them runs, it adds to the app's
`package.json` each native module its libraries import that it does not list, and the module's
config plugin to `app.json` where Expo does not apply it on its own. `nx sync` applies the same
changes by hand, and `nx sync:check` fails when there are any to make, for CI. It only adds: a
module stays listed when no library imports it any more. An `@ng-native/expo` service reaches its
module only when it is injected, so list those modules in the app yourself, as each module's page
says. `npx expo install --check` checks the versions of the app's own dependencies only.

## An @nx/angular workspace

A workspace from the `angular-monorepo` preset works as it is, web app included. Its Angular and
its Vitest 4 are both in the ranges Angular Native accepts, so there is nothing to move first.

The TypeScript preset (`--preset=ts`) works too, with one difference: `@nx/angular` cannot be added
to it, because Angular does not support TypeScript project references, so there is no Angular
library generator there. `nx g @ng-native/nx:library` uses `@nx/js:library` instead, below; the
app imports the library like any other.

## Libraries

```sh
nx g @ng-native/nx:library packages/ui
nx g @ng-native/nx:component profile-card --project ui
nx test ui
```

In the TypeScript preset the library is `@org/ui`: `--project @org/ui` and `nx test @org/ui`.

`@nx/angular:library` writes tests that run on jsdom through Analog, with a `TestBed` spec for a
`<p>`, and none of it can render a native component. `@ng-native/nx:library` runs the workspace's
own library generator without its tests: `@nx/angular:library`, with the options `nx g` would give
it, including the defaults in `nx.json`, or `@nx/js:library` with no bundler in the TypeScript
preset. In place of the tests it writes:

- a `vitest.config.mts` with the app's Node project alone, whose `ngNative()` renders on the fake
  Fabric in Node, and a `test` target that runs it once;
- a `tsconfig.spec.json` for the tests, referenced from the library's `tsconfig.json`;
- a component built from `<view>` and `<text>`, where the generator put its own, and a `.test.ts`
  beside it that renders it.

In the TypeScript preset the library's source imports with `.ts`, as its tests and the examples on
this site do: `tsconfig.lib.json` allows it and `src/index.ts` is written that way. TypeScript only
takes that where a project emits declarations and no JavaScript, which is the preset's own setting,
so a workspace that has changed it keeps the `.js` imports `@nx/js` writes.

In the TypeScript preset `nx typecheck @org/ui` checks the library's templates as well as its code,
as an app's does: the generator writes `tsconfig.typecheck.json` beside `tsconfig.lib.json` and a
`typecheck` target that runs `ngc` on it, in place of the `tsc` `@nx/js` infers, and adds
`@angular/compiler-cli` to the library's dev dependencies, with the app's Babel 7 `@babel/core`
beside it so the Babel 8 the compiler depends on does not answer React Native's peer. A misspelled
input or a binding of the wrong type in a library component fails the target.

It adds `@ng-native/components`, `@ng-native/testing` and Vitest where the library's dependencies
go: its own `package.json` in the TypeScript preset, and the root's otherwise. It takes `--name`,
`--tags` and `--skipInstall`, as the app generator does.

`@nx/angular:component` writes the same `<p>` and `TestBed` spec. `@ng-native/nx:component` writes
a native component and its test instead, in a folder of its own under the library's `src/lib`, or
under an app's `src/app`. It takes `--flat` for no folder of its own, `--skipTests`, and a path in
the name, such as `settings/profile-card`.

## Tailwind

```sh
nx g @ng-native/nx:tailwind mobile --library ui
```

In the TypeScript preset that is `nx g @ng-native/nx:tailwind @org/mobile --library @org/ui`.

This sets up [Tailwind](/packages/tailwind) in an app, and in the libraries whose classes it uses.
An app that uses a library's classes without this renders them unstyled, and nothing fails: the
classes are only missing from the sheet. For the app, it writes `src/styles.css`, wraps the Metro
config in `withTailwind`, passes the sheet to `mount` as `globalStyles` in `src/main.ts`, and adds
`@ng-native/tailwind` and Tailwind where the app's dependencies go. It also makes sure the
`typecheck` target builds the sheet first and `.gitignore` ignores `.angular-native/`, which an app
generated before either needs.

Tailwind scans the app's directory, so each library named with `--library` (several, separated by
commas) gets a theme of its own, which the app loads, as
[a shared library](/packages/tailwind#a-shared-library-in-an-nx-workspace) describes:

- With Tailwind 4, the library's `theme.css` names its sources with `@source` and holds its
  `@theme`, and the app's `styles.css` imports it.
- With Tailwind 3, the library's `tailwind.preset.cjs` lists its sources in `content`. The app's
  `tailwind.config.js` takes each library's preset ahead of Angular Native's and spreads its
  `content` into its own, and `@nx/enforce-module-boundaries` in the root ESLint config allows the
  relative `require` of a `tailwind.preset.cjs`.

A project whose Vite config runs `ngNativeWeb()` also builds for
[a browser](/packages/web#with-tailwind), which takes the web preset in place of the native one.
Beside the native build, in the app's own directory, the generator sets up both; a browser app of
its own gets the web build only. For the web build it writes:

- With Tailwind 4, a stylesheet importing `@ng-native/tailwind/web.css` and each library's
  `theme.css`: `src/styles.web.css` beside a native build, whose `src/styles.css` imports
  `native.css`, and `src/styles.css` otherwise. `tailwindcss()` from `@tailwindcss/vite` goes
  after `ngNativeWeb()` in the Vite config.
- With Tailwind 3, a config with `web-preset.cjs` and each library's preset:
  `tailwind.web.config.js`, which takes the rest from the app's `tailwind.config.js`, beside a
  native build, and `tailwind.config.js` otherwise (`.cjs` in a package with `"type": "module"`).
  A `postcss.config.js` runs Tailwind with it, on `src/styles.css`.

`index.html` links the stylesheet, unless the module it loads imports it already.

A library that has the file already keeps it. `--tailwindVersion=3` sets up Tailwind 3; without it
the generator takes the major the workspace has installed, or 4. (`nx g` reads `--version` as its
own.) Running it again changes nothing, and running it with another library adds that one. A file
it cannot follow, such as a Metro config whose export spans several lines, is left as it is, with a
warning saying what to add by hand.

## NativeScript

```sh
nx g @ng-native/nx:nativescript mobile
```

This sets up [NativeScript](/packages/nativescript) in an app: it adds `@ng-native/nativescript`,
`@nativescript/react-native` and `react-native-worklets` (the version the app's Expo SDK bundles)
where the app's dependencies go and `@nativescript/types-android` beside them as a dev dependency,
adds `@ng-native/nativescript` to the config plugins in `app.json`, writes `src/nativescript.d.ts`
referencing the iOS and Android SDKs' types, and adds `provideNativeScript()` to the providers
`mount` is given in `src/main.ts`, joining any list it passes already. Running it again changes
nothing. A `src/main.ts` it cannot follow, or whose providers are not written as a list there, is
left as it is, with a warning saying what to add by hand. The app needs rebuilding afterwards, as
for any native module.

## macOS and Linux

```sh
nx g @ng-native/nx:desktop mobile
```

This adds macOS and Linux to an app, as
[the Angular CLI's `desktop` schematic](/packages/schematics#macos-and-linux) does, with
`@ng-native/desktop` where the app's dependencies go, and three targets: `nx run mobile:macos`,
`nx run mobile:linux` and `nx run mobile:package`. `macos` and `linux` load the app from the dev
server `nx start` runs, on the app's own port. `package` passes on what follows it, so
`nx run mobile:package --format dmg` makes the `.dmg`, `--format mas` the Mac App Store package,
and `nx run mobile:package --os linux --format deb --maintainer "Ada Lovelace <ada@example.com>"` a
`.deb` from a Mac. See [`@ng-native/desktop`](/packages/desktop) for the commands and the plugin
options.

## iOS and Android

```sh
nx g @ng-native/nx:mobile desktop
```

This adds iOS and Android to a desktop-only app, as
[the Angular CLI's `mobile` schematic](/packages/schematics#ios-and-android) does, with
`expo-status-bar` and `expo-system-ui` where the app's dependencies go. It also removes the app from
the `exclude` list of `@nx/expo`'s plugin in `nx.json`, so the plugin infers `run-ios`,
`run-android`, `prebuild` and the EAS targets for it again. An app whose Metro is not on 8081 gets
its own `run-ios` and `run-android` with that port.

## Options

`nx g @ng-native/nx:app <directory>` takes `--name` (the directory's last segment by default),
`--bundleIdentifier`, `--tags`, `--linter`, `--desktopOnly`, `--skipInstall` and `--skipFormat`,
which leaves the generated files unformatted. `--linter=eslint` adds an `eslint.config.mjs` with
[`@ng-native/eslint-plugin`](/packages/eslint-plugin)'s recommended rules, its four packages and a
`lint` target; `--linter=none`, the default, adds none of them. In a workspace with an
`eslint.config.mjs`, `.js` or `.cjs` at its root, the app's config spreads it first, so that the
root's rules, `@nx/enforce-module-boundaries` among them, apply to the app. An app made without
`--tags` has no tags, so it matches none of that rule's `depConstraints` except one whose
`sourceTag` is `*`, and a workspace with constraints that name tags cannot import a library into
it: pass the tags they name, as in `--tags=type:app,scope:mac`. Where `depConstraints` is empty,
Nx does not check, and tags change nothing.

`--desktopOnly` and `--bundleIdentifier` work as
[`--desktop-only` and `--bundleIdentifier`](/packages/schematics#options) do for the Angular CLI.
In Nx, a desktop-only app is also added to the `exclude` list of `@nx/expo`'s plugin in `nx.json`,
with `export` and `install` written in its `project.json`, so it has no `run-ios`, `run-android`,
`prebuild` or EAS targets until [`nx g @ng-native/nx:mobile`](#ios-and-android) adds iOS and
Android back. Its `test` target runs `vitest run --project node-macos --project node-linux`.
`nx g @ng-native/nx:init --desktopOnly`, the generator `nx add` runs, makes it the default of every
app generated in the workspace, in `nx.json`.

## Upgrading

`nx migrate @ng-native/nx@latest` moves every `@ng-native/*` package the root `package.json` lists
to the new version with it, since they are released together. It also queues a migration,
`sync-app-versions`, which `nx migrate --run-migrations` runs: it moves the `@ng-native/*` versions
in each project's own `package.json` too, where a workspace with package-manager workspaces
installs them from, keeping a `^` or `~`. A `workspace:` link and a peer range stay as they are.
The migration then prints the install to run, since `nx migrate` installs by itself only when the
root `package.json` changed. Any other migration the update crosses runs beside it; they come from
`@ng-native/migrate`, and [Updating an app](/guide/updating) lists what each does and what is left
to do by hand.

```sh
nx migrate @ng-native/nx@latest
pnpm install
nx migrate --run-migrations
pnpm install
```
