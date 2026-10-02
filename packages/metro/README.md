# @ng-native/metro

The build-time half of Angular Native: a Metro config preset and Babel transformer that compiles
Angular components ahead of time, turns each component's `styles` into the rule set
[`@ng-native/fabric`](https://github.com/ng-native/ng-native/blob/main/packages/fabric)
reads at runtime, links partially-compiled Angular libraries, and wires up hot reload with no
Angular dev server.

Alpha: APIs may change before 1.0.

## Install

Most apps start from `npx create-expo-app@latest my-app --template @ng-native/template`, which
already has this wired into `metro.config.js`. Otherwise:

```sh
npm install @ng-native/metro
npm install expo
```

## Example

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');

module.exports = withAngularNative(getDefaultConfig(__dirname));
```

No options in the common case. In a monorepo where the `@ng-native/*` packages live outside the
app's own `node_modules`, pass `{ workspaceRoot }`:

```js
module.exports = withAngularNative(getDefaultConfig(__dirname), {
  workspaceRoot: __dirname + '/../..',
});
```

A component library from npm draws unstyled by default: its CSS is written for a browser, and
nothing compiles it. Name the packages whose component CSS should be compiled into native sheets,
as the app's own is, with `{ libraryStyles: ['@acme/ui'] }`; what native cannot express is dropped,
counted in one build warning a file, or listed with `ANGULAR_NATIVE_LIBRARY_WARNINGS=all`. See
[Configuration](https://ng-native.com/packages/metro/configuration).

## What's in the package

- `./config.cjs` - `withAngularNative`, the Metro config preset.
- `angular-transform.cjs` (the package's `main`) - the Babel/Metro transformer itself, wired in by
  the preset.
- `css/*.cjs` - the build-time CSS compiler, also used by `@ng-native/tailwind`.
- `polyfills/*.js` - the `ng-dev-mode`, `animation-globals` and `finalization-registry` polyfills
  the preset installs before `@angular/core` first runs.

## Docs

- [Metro](https://ng-native.com/packages/metro)
- [Configuration](https://ng-native.com/packages/metro/configuration)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
