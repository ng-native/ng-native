# @ng-native/nx

Nx generators for Angular Native: `nx add @ng-native/nx`, an app generator that adds an Expo app
project to the workspace, able to import its Angular libraries, and library and component
generators whose tests render on the fake Fabric.

Alpha: APIs may change before 1.0.

## Install

```sh
nx add @ng-native/nx
nx g @ng-native/nx:app apps/mobile
nx g @ng-native/nx:library packages/ui
```

`nx add` adds `@nx/expo` at the workspace's Nx version and registers its plugin, which infers the
app's Expo targets. The generator writes the template's app, with a `metro.config.js` wrapped in
`withNxMetro` so workspace libraries resolve, and adds `typecheck` and `test` targets.

## Example

```sh
nx start mobile            # expo start
nx run mobile:run-ios      # expo run:ios
nx export mobile --platform ios
nx test mobile             # vitest run, on the fake Fabric
nx typecheck mobile
```

In a workspace whose root package is scoped, the project is `@org/mobile`.

## What's in the package

- `generators.json` - `init`, which `nx add` runs, `application` (alias `app`), `library` (alias
  `lib`), `component` (alias `c`), and `sync-native-modules`, the sync generator an app runs before
  `start`, `export` and `prebuild`.
- `files/` - the template's source files, which a test keeps identical to `template/`.

## Docs

- [Nx](https://ng-native.com/packages/nx)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md)

## License

MIT
