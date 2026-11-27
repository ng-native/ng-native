# @ng-native/turbo

Turborepo generators for Angular Native: `turbo gen` for an Expo app as a workspace package, a
library of native components and components in either, tested in Node on the fake Fabric, and a
command that lists in each app the native modules its libraries use.

Alpha: APIs may change before 1.0.

## Install

```sh
npx @ng-native/turbo init
pnpm install
pnpm turbo gen ng-native-app --args apps/mobile none
pnpm turbo gen ng-native-library --args packages/native-ui
pnpm install
```

`init` writes `turbo/generators/config.ts`, which registers the generators with `turbo gen`, or,
where the workspace has one, says to import `ngNative` from `@ng-native/turbo` and call
`ngNative(plop)` in it. It adds `@ng-native/turbo` to the root's dev dependencies, and adds the
`build`, `typecheck`, `test`, `lint` and `dev` tasks the apps run to `turbo.json` where it lacks
them, and with pnpm declines `esbuild`'s install script in `pnpm-workspace.yaml`, which pnpm 11
otherwise stops the install over. Install again after a generator that writes a package.

## Example

```sh
pnpm --dir apps/mobile start        # Metro, with Expo's keyboard shortcuts
pnpm turbo run dev                  # every app's Metro, each on a port of its own
pnpm turbo run test typecheck       # Vitest in Node, and ngc
pnpm turbo run build                # expo export into each app's dist/, cached
npx ng-native-turbo sync --check    # fails when an app lacks a native module or config plugin
```

## What's in the package

- `index.cjs` - `ngNative(plop)`, which registers `ng-native-app`, `ng-native-library`,
  `ng-native-component` and `ng-native-sync` with `turbo gen`.
- `cli.cjs` - `ng-native-turbo init` and `ng-native-turbo sync`.
- `files/` - the template's files, which a test keeps identical to `template/`.

## Docs

- [Turborepo](https://ng-native.com/packages/turbo)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md)

## License

MIT
