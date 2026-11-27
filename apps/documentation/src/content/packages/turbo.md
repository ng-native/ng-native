---
title: Turborepo
summary: turbo gen generators for an app, a library and a component in a Turborepo workspace, and
  a check that each app lists the native modules its libraries use.
---

# Turborepo

`@ng-native/turbo` adds Angular Native apps and libraries to a [Turborepo](https://turborepo.com)
workspace, through Turborepo's own generator command, `turbo gen`:

```sh
npx @ng-native/turbo init
pnpm install
pnpm turbo gen ng-native-app --args apps/mobile none
pnpm install
pnpm --filter @repo/mobile start
```

The first install brings in the generators `init` added; the second, the new app's dependencies.
Install again after each generator that writes a package.

An app is an ordinary workspace package with its own `package.json`, the way the workspace's other
apps are, and `turbo run` builds, tests and caches it with them. Expo's Metro config finds the
workspace's packages, so the app's `metro.config.js` is the template's, unchanged, and a library
needs no build step: Metro compiles its components ahead of time with the app's own.

A package the generators write is named under the workspace's scope: the root `package.json`'s, or,
where the root has none, the one the workspace's scoped packages share. `create-turbo` names its
root `my-turborepo` and its packages `@repo/ui` and the like, so there the app is `@repo/mobile`, as
in the commands on this page. Where the root is unscoped and the packages have no scope, or more
than one, the app is `mobile`.

The commands on this page are pnpm's. In an npm workspace they are `npx turbo gen` and
`npm run start -w @repo/mobile`, in Yarn `yarn turbo gen` and `yarn workspace @repo/mobile start`,
and the generators write each app's `AGENTS.md` with its own package manager's commands.

For an Nx workspace, use [`@ng-native/nx`](/packages/nx) instead.

## What init does

`turbo gen` runs the generators `turbo/generators/config.ts` registers. `init` writes that file,
registering this package's:

```ts
import type { PlopTypes } from '@turbo/gen';
import { ngNative } from '@ng-native/turbo';

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  ngNative(plop);
}
```

A workspace with a config of its own, `config.ts` or one in JavaScript (`.js`, `.cjs`, `.mts` or
`.mjs`), keeps it, and `init` says to add the import and the `ngNative(plop)` call to it:
`turbo gen` loads only the first of them, so a `config.ts` written beside a `config.js` would hide
the workspace's own generators. `init` also adds `@ng-native/turbo` to the root's dev dependencies,
which is where the config imports it from, `@turbo/gen` for the config's types, at the workspace's
`turbo` range, and `turbo` itself if the root has none.

In `turbo.json`, or `turbo.jsonc` where the workspace has that instead, it adds each of these tasks
the workspace does not define yet, and leaves the ones it does define alone:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**"]
    },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^test"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

A `turbo.json` or `turbo.jsonc` with comments is not plain JSON, so `init` stops without changing
it, and names the tasks to add by hand. `create-turbo` calls its type-checking task `check-types`;
the app's script is `typecheck`, as the template's is, so `turbo run check-types` does not run it.

With pnpm, `init` also declines `esbuild`'s install script in `pnpm-workspace.yaml`, unless the
workspace has decided it already:

```yaml
allowBuilds:
  esbuild: false
```

`esbuild` comes in through `@turbo/gen` and through the Vite each app's and library's Vitest runs
on, and pnpm 11 stops an install, with `ERR_PNPM_IGNORED_BUILDS`, while a dependency's install
script is neither allowed nor declined. Its script only checks the binary that its optional
dependency for the OS installs. An `allowBuilds` written on one line, `{ ... }`, is left as it is,
and `init` says what to add to it.

## The generators

Each generator asks for what it needs, and `--args` answers the questions in order. Pass every
answer: `turbo gen` asks for one left out.

| Generator             | `--args`                       | What it writes                                   |
| --------------------- | ------------------------------ | ------------------------------------------------ |
| `ng-native-app`       | `apps/mobile none`             | an app; `eslint` in place of `none` adds ESLint  |
| `ng-native-library`   | `packages/native-ui`           | a library of native components                   |
| `ng-native-component` | `profile-card @repo/native-ui` | a component and its test, in an app or a library |
| `ng-native-sync`      | (none)                         | the native modules each app's libraries use      |

The library's directory defaults to `packages/native-ui`, since `create-turbo` already has a React
library at `packages/ui`.

A directory outside the workspace's globs is added to `pnpm-workspace.yaml`, or to the root
`package.json`'s `workspaces` in an npm, Yarn or Bun workspace, as `apps/*` when nothing else is in
`apps/`.

## The app

The app is the template's: `src/main.ts`, `src/app/app.ts`, its tests, `metro.config.js`,
`tsconfig.json` and `vitest.config.mts` as they are, and an `app.json` named for the app, with
`com.<scope>.<name>` as its bundle identifier, `com.repo.mobile`, made valid for both iOS and
Android. Change `ios.bundleIdentifier` and `android.package` in `app.json` before the first build to
use another. It lists its dependencies, at the template's
versions or the root's where the root has a version that works, and saves exact versions where the
workspace does. Its scripts:

| Script      | What runs                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- |
| `dev`       | `expo start`, for `turbo run dev`                                                         |
| `start`     | `expo start`, and `ios` and `android` open a simulator with it                            |
| `build`     | `expo export --output-dir dist`, the iOS and Android bundles                              |
| `test`      | `vitest run --project node`, the tests that run in Node                                   |
| `typecheck` | `ngc -p tsconfig.typecheck.json --noEmit`, which checks the templates as well as the code |
| `lint`      | `eslint .`, with `eslint` as the second answer only                                       |

Turborepo passes keystrokes only to a task marked `interactive`, so Expo's shortcuts (`i` and `a`
for a simulator, `r` to reload) do not reach `turbo run dev`. Run `pnpm --filter @repo/mobile start`
to use them.

Each app gets a Metro port of its own, so `turbo run dev` runs several side by side. The first uses
Expo's default, 8081. Each later one takes the lowest port no other app's `expo start` uses, in all
four of its scripts (`expo start --port 8082`).

The app has a `turbo.json` of its own, which extends the root's:

```json
{
  "extends": ["//"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**"]
    },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^test"] }
  }
}
```

- **`outputs`** of `build` is where `expo export` writes the bundles, so a cache hit restores them.
  `typecheck` has none: the Tailwind sheet it builds into `.angular-native/` before `ngc` is there
  only once [Tailwind](/packages/tailwind) is added, and Turborepo warns on every run of a task
  whose outputs match nothing. Metro builds the sheet again for `build` and `dev`.
- **`inputs`** adds `.env*` to the files Turborepo hashes. Expo inlines each `EXPO_PUBLIC_` variable
  into the bundle, and a workspace's `.gitignore` usually ignores `.env*.local`, as the template's
  does. Turborepo does not hash a file git ignores, so without this a changed `.env.local` replays
  the bundle built with the old value. An `EXPO_PUBLIC_` variable set in the shell needs nothing:
  Turborepo recognises Expo from the app's dependencies, passes those variables to the task and
  hashes them.

- **`dependsOn`** makes a change to a library's source rerun the app's `build`, `typecheck` and
  `test`, which compile that source with the app's, although the library has no `build` of its own.
  Turborepo hashes a workspace dependency into a task only through a `^` dependency, so without it
  an edit to a library replays the app's old bundle or test run. It is in the app's `turbo.json`
  because a workspace's own root task, such as a `build` written before the app, may not have it.

`typecheck` reads `tsconfig.typecheck.json`, which extends the app's `tsconfig.json` and maps every
`@ng-native` package to the app's own copy. pnpm gives a library a copy of its own of a package
whose peers it does not share with the app, which an app that installs `react-native-reanimated` or
`react-native-gesture-handler` brings about, and `ngc` given both copies stops at
`NG3004: Unable to import symbol` before it checks a template. Metro and Vitest resolve to the app's
copy themselves.

## The library

`ng-native-library packages/native-ui` writes a package that exports its TypeScript source:

```json
{
  "name": "@repo/native-ui",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "ngc -p tsconfig.json", "test": "vitest run" },
  "peerDependencies": {
    "@angular/core": "^22.0.0",
    "@ng-native/components": ">=0.25.0"
  }
}
```

with Angular, `@ng-native/components`, `@ng-native/testing`, the Angular compiler, TypeScript and
Vitest as dev dependencies, at the app's versions. Angular and the components are peers, so the
bundle has the app's copy. Metro resolves a library's imports from its own `node_modules`, where
pnpm links its dev dependencies, so a dev dependency at a version the app does not have is a second
copy in the bundle, and a second `@angular/core` fails at runtime far from the cause. Keep the
versions in step with the apps', as [updating](#updating) does. The components' peer range is open
above because updating moves the versions a package installs and leaves a peer range as it is.

It starts with a component, `src/lib/native-ui.ts`, and its test, which renders it in Node on a fake
of the native side, as an app's tests do. Its selectors are prefixed with the workspace's scope:
`repo-native-ui`. To use it, add `"@repo/native-ui": "workspace:*"` to an app's dependencies (`"*"`
with npm), install, and import `NativeUi` from `'@repo/native-ui'` in the app's components.

## The component

`ng-native-component profile-card @repo/native-ui` writes `profile-card.ts`, built from `<view>` and
`<text>` with an inline template, and `profile-card.test.ts` beside it, in a folder of its own:
under `src/app/` in an app and `src/lib/` in a library, where `src/index.ts` exports it. The second
answer is the package's name or its directory. A name with a slash, `cards/profile-card`, puts it
in that subfolder.

## Native modules

Expo's autolinking finds a native module a library uses, as it walks the app's dependencies, but it
applies a module's config plugin only when the app's `app.json` names it. A plugin is what writes a
module's native settings, such as the iOS usage description a camera needs, so without it the app
builds and can fail when it uses the module: iOS stops an app that asks for the camera without one.
And `npx expo install --check` checks the versions of the app's own dependencies only. `sync` lists
each module in the app, where `expo install --check` holds it to the Expo SDK's version, and adds
its config plugin.

```sh
npx ng-native-turbo sync            # list them in each app that lacks one
npx ng-native-turbo sync --check    # change nothing, and fail if an app lacks one: for CI
```

`pnpm turbo gen ng-native-sync` does the same as the first. For each app it follows the workspace
libraries it depends on, and theirs, and takes each package a library lists in `dependencies`,
`optionalDependencies` or `peerDependencies`: pnpm links nothing else for it to import. A package
counts when it has native code Expo's autolinking finds, and so does a native module reached through
its required peers, at any depth, as `@ng-native/icons` peers on `react-native-svg`. The app gets
the root's range where the root lists one, then the range the library installs it at in
`dependencies`, `optionalDependencies` or `devDependencies`, and otherwise the version installed. A
relative `file:`, `link:` or `portal:` range is rewritten to name the same directory from the app's.
A peer range is never copied: it says what the library accepts, often `*`, and an app listing `*`
would install the newest release rather than the one its Expo SDK supports. The app gets the
module's config plugin in its `app.json` unless Expo applies that plugin itself. It only adds: a
module stays listed when no library uses it any more, since the app may use it too.

## Updating

Run `@ng-native/migrate` from the workspace's root, before installing the new versions:

```sh
npx @ng-native/migrate@latest
pnpm install
```

It reads the version from the `@ng-native/turbo` the root lists, runs the migrations newer than
that across the workspace, and moves the `@ng-native` versions every package's `package.json`
installs, the root's, the apps' and the libraries', to the new release. See
[Updating an app](/guide/updating) for what the migrations do.
