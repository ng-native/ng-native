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
the rest of its code. In a workspace whose root package is scoped, as the TypeScript preset's is,
the project is named for the scope the way Nx names its own: `nx start @org/mobile`.

## What nx add does

It adds `@nx/expo`, at the workspace's own Nx version, and registers `@nx/expo`'s plugin in
`nx.json`. An Angular Native app is an Expo app, and that plugin already infers an Expo project's
targets from its `app.json`, `metro.config.js` and `package.json`, so there is nothing to
reimplement.

It does not run `@nx/expo:init`, which installs Expo itself at the SDK `@nx/expo` was released
against. On Nx 23.2 that is SDK 56, with a `react-dom` that asks for React 19.3; an Angular Native
app needs SDK 57 and React 19.2.3, and npm refuses to install the two side by side. It adds the
two things `init` would have that the app does need, at the app's versions: `react-dom` at the
app's React, because `@nx/expo` depends on `@nx/react` and npm would otherwise take its
`react-dom` peer at 19.3 and refuse every later install, and `@expo/cli`, which `nx prebuild` loads
from the workspace root.

With package-manager workspaces it adds `expo`, `react` and `react-native` at the root as well,
at the app's versions, in place of `@expo/cli`. The package manager resolves `@nx/expo`'s `expo`
peer in the root's context, and with nothing there to match, pnpm took that Expo's React Native and
React at the newest versions there were, a second copy of each beside the app's. Keep these root
versions in step with the app's when upgrading it.

It also adds Babel 7's `@babel/runtime` and `@babel/core` at the workspace root: the runtime Expo's
Babel preset imports, and the core every plugin in that preset peers on. In an `@nx/angular`
workspace, `@angular-devkit/build-angular` otherwise puts Babel 8's copies there. Babel 8's runtime
has no `regenerator`, and Metro warns on every `nx start` that it fell back to another copy, and
its core leaves each plugin's peer unmet. Angular's build keeps its own Babel 8.

And it adds `@expo/metro` at the root, at the range the app's `expo` depends on. `withNxMetro` in
the app's `metro.config.js` loads it from the app's directory up, and pnpm keeps a dependency of
`expo` out of the root's `node_modules`. `expo start` still finds it, through the `NODE_PATH`
pnpm's `expo` shim sets, but the `typecheck` target loads the config with plain `node`, which
without it fails with `Unable to load Metro config`.

In a pnpm workspace it also decides the two install scripts `@nx/expo` brings in, through
`@nx/jest`: `@parcel/watcher` and `unrs-resolver`. It sets them to `false` under `allowBuilds` in
`pnpm-workspace.yaml`, since both ship prebuilt binaries and their scripts only build from source.
pnpm 11 otherwise stops the install with `ERR_PNPM_IGNORED_BUILDS` until every such script is
decided. A decision the workspace already made stays, and an `allowBuilds` written as a flow mapping
is left as it is, with a warning naming the two to decide.

## The targets

| Command                 | From           | What runs                                                       |
| ----------------------- | -------------- | --------------------------------------------------------------- |
| `nx start mobile`       | `project.json` | `expo start`, and `serve` likewise                              |
| `nx run mobile:run-ios` | `@nx/expo`     | `expo run:ios`, and `run-android` likewise                      |
| `nx export mobile`      | `@nx/expo`     | `expo export`; `--platform ios` for one platform                |
| `nx prebuild mobile`    | `@nx/expo`     | `expo prebuild`                                                 |
| `nx build mobile`       | `@nx/expo`     | an EAS build, on Expo's machines                                |
| `nx test mobile`        | `project.json` | `vitest run`, through [`@ng-native/testing`](/packages/testing) |
| `nx typecheck mobile`   | `project.json` | `ngc --noEmit`, which checks the templates as well as the code  |

`typecheck` and `test` are the two `@nx/expo` does not provide. Expo's `tsconfig` sets `noEmit`, and
`@nx/js` disables its own inferred `typecheck` for a project that does, so the generator writes one.
`test` runs Vitest once, where the target `@nx/vitest` would infer watches. `start` is written too:
`@nx/expo` infers it as its `@nx/expo:start` executor, which Nx 23 deprecates and warns about on
every run, so the generator runs the same `expo start` directly. `serve` runs it as well, in place
of the `expo start --web` `@nx/expo` infers for every Expo app, since the app has no web platform.
`nx prebuild` and `nx build` still use `@nx/expo`'s executors, and print the same deprecation
notice. `typecheck` loads `metro.config.js` before `ngc`, as the template's script does, so that
once [Tailwind](/packages/tailwind) is added, the sheet `src/main.ts` imports exists on a fresh
checkout. It declares `.angular-native/` as its output, so a cache hit restores the sheet too.

Each app gets a Metro port of its own, so `nx run-many -t start` runs several side by side. The
first Expo app in the workspace uses Expo's default, 8081, with a plain `expo start`. Each later one
takes the lowest port no other app's `start` or `serve` uses (`expo start --port 8082`, and so on),
and Expo Go opens it at `exp://127.0.0.1:8082`. A later app's `run-ios` and `run-android` pass the
same port (`expo run:ios --port 8082`), since the build bakes in the port its app loads from. The
first app keeps the ones `@nx/expo` infers. An Expo app whose `start` is inferred counts as on 8081.

## The files

The app is the template's: `src/app/app.ts`, `src/main.ts` and `src/app/app.test.ts` as they are,
and an `app.json` named for the project. Its `app.json` names `ios` and `android` as the platforms,
because Expo adds `web` whenever `react-dom` resolves, and Nx always installs one. Its `.gitignore`
ignores the `ios/` and `android/` projects `expo prebuild` writes and the `.angular-native/`
Tailwind generates, as the template's does. Three files differ, each because of something Nx does:

- **`metro.config.js`** applies the preset around `withNxMetro`, from `@nx/expo`, which resolves
  the workspace's libraries and watches them. Without it, Metro cannot follow a tsconfig path alias
  and reports `Cannot resolve @org/ui`. The preset goes on the outside so its resolver can wrap
  Nx's: a library written for TypeScript's module resolution imports `./lib/ui.js` for a `ui.ts`,
  and the preset resolves that to the `.ts` file, as TypeScript does.
- **`tsconfig.json`**, in a workspace with a `tsconfig.base.json`, extends it after Expo's, which
  is where the path aliases are, and puts back the Expo settings the workspace's base overrides.
  With package-manager workspaces it does so only when that file has a `paths` list: the
  TypeScript preset's has none, and its libraries are linked as packages instead.
- **`vitest.config.mts`** adds `nxViteTsPaths()` in a workspace with path aliases, since Vitest
  does not read them from tsconfig either, and adds `@nx/vite` for it if the workspace has none.
  The `angular-monorepo` preset does not, and a library generated after the app is the usual case.

## Where the dependencies go

In a workspace with package-manager workspaces, which is Nx's default since 20, the app is a
workspace package and lists its own dependencies, so pnpm links them. If no workspace glob covers
its directory, the generator adds one: Nx's TypeScript preset starts with `packages/*` only. That
is `apps/*` for `apps/mobile`, or `apps/mobile` itself when another directory in `apps` already
has a `package.json`, so the glob takes in no package the workspace has not listed. In an
integrated workspace, with one root `package.json` and path aliases, which is what the `@nx/angular`
preset makes, they go in the root `package.json`. A version already there is left alone. The
app's own `package.json` still names them all, at the root's ranges, though nothing installs from
it: Expo links the native modules that file names and no others.

In a workspace package the app takes the root's version of a package the root already lists, when
every version it allows is one the app accepts. A workspace that saves exact versions
(`savePrefix: ''` or `saveExact: true` in `pnpm-workspace.yaml`, `save-exact=true` in `.npmrc`,
`defaultSemverRangePrefix: ""` in `.yarnrc.yml`, or `exact = true` in `bunfig.toml`) gets exact
versions where it has none already: the newest each of the app's ranges allows, as `npm view`
finds it from the workspace's root, or the lowest when the registry cannot be reached. `@nx/expo`
and `@nx/vite` take the Nx that is running when the workspace lists Nx at a range.

## Native modules a library imports

Expo links the native modules the app's `package.json` names and no others. Expo Go contains every
module in the SDK, so an app using a library that imports one the app does not list works in Expo
Go, and a development or release build of it has no native code for that module.

The generator registers `@ng-native/nx:sync-native-modules`, a sync generator, on the app's
`start`, `export` and `prebuild` targets. Before any of them runs, it reads from Nx's project graph
what the app's libraries import, directly or through another library, and adds to the app's
`package.json` each native module there that the app does not list: a package with an Expo module
config, a podspec or an Android project. A package a library imports can need one too: it counts
when that package peers on it without marking the peer optional, as `@ng-native/icons` does on
`react-native-svg`. The range is the root's, or the library's own in a workspace package, or the
installed version. A module with a config plugin has it added to the app's `app.json`, unless it is
one Expo applies without being listed.

`nx sync` applies the same changes by hand, and `nx sync:check` fails when there are any to make,
for CI. It only adds: a module stays listed when no library imports it any more, since the app may
use it itself. An `@ng-native/expo` service reaches its module only when it is injected, so the
graph records `@ng-native/expo` rather than the module: list those in the app, as each module's
page says. An app generated before the sync generator existed registers it by adding
`"syncGenerators": ["@ng-native/nx:sync-native-modules"]` to those three targets in its
`project.json`.

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

`@nx/angular:library` writes tests that run on jsdom through Analog, with a `TestBed` spec for a
`<p>`, and none of it can render a native component. `@ng-native/nx:library` runs the workspace's
own library generator without its tests: `@nx/angular:library`, with the options `nx g` would give
it, including the defaults in `nx.json`, or `@nx/js:library` with no bundler in the TypeScript
preset. In place of the tests it writes:

- the app's `vitest.config.mts`, whose `ngNative()` renders on the fake Fabric in Node, and a
  `test` target that runs it once, as the app's does;
- a `tsconfig.spec.json` for the tests, referenced from the library's `tsconfig.json`;
- a component built from `<view>` and `<text>`, where the generator put its own, and a `.test.ts`
  beside it that renders it.

In the TypeScript preset the library's source imports with `.ts`, as its tests and the examples on
this site do: `tsconfig.lib.json` allows it and `src/index.ts` is written that way. TypeScript only
takes that where a project emits declarations and no JavaScript, which is the preset's own setting,
so a workspace that has changed it keeps the `.js` imports `@nx/js` writes.

In the TypeScript preset `nx typecheck ui` checks the library's templates as well as its code, as
an app's does: the generator writes `tsconfig.typecheck.json` beside `tsconfig.lib.json` and a
`typecheck` target that runs `ngc` on it, in place of the `tsc` `@nx/js` infers, and adds
`@angular/compiler-cli` to the library's dev dependencies. A misspelled input or a binding of the
wrong type in a library component fails the target.

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

## Options

`nx g @ng-native/nx:app <directory>` takes `--name` (the directory's last segment by default),
`--bundleIdentifier`, `--tags`, `--skipInstall` and `--skipFormat`, which leaves the generated files
unformatted. `--bundleIdentifier` is the iOS bundle identifier and Android package in `app.json`;
it defaults to `com.<scope>.<name>`, from the workspace's npm scope and the app's name with
anything but letters and digits removed, where `expo prebuild` would otherwise use
`com.anonymous.<name>`.

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
