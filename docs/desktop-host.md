# The desktop host

How `packages/desktop` is laid out, and how a prebuilt host is published. What an app
author needs is on the documentation site, under [Desktop](https://ng-native.com/packages/desktop).

## Layout

- `native/core`: the toolkit-free C++ core (mounting, the view tree and hit testing, input and
  hover, Tab order, the app's windows and their autosaved frames (`app-windows.h`), menus,
  shortcuts and the back and forward inputs (`app-menus.h`), the tray and the Dock
  (`tray-and-dock.h`), the split view and the tabs (`split-view.h`, `tabs-host.h`), presented
  screens (`screen-presentation.h`), processes and the shell (`processes.h`), the desktop Expo
  modules (`desktop-expo.h`), the accessibility mapping, the native controls' props and
  measuring, text measurement, the module registry and desktop view props, the dev server
  connection, the default menu bar and React Native's iOS-shaped modules in `src/modules`), with
  tests on an
  in-memory backend that run on Linux and macOS. A backend answers the OS calls through narrow
  interfaces: `network.h` (HTTP and WebSocket) and `system.h` (URLs, alerts, appearance,
  clipboard, preferences, image sizes and the app's data directory).
- `native/appkit`: the AppKit backend and the `ngn-macos` binary.
- `native/scripts`: fetching the pinned sources, building Hermes and building the host.
  `NGN_DESKTOP_CACHE` moves the cache and `NGN_JOBS` caps parallel compiles. `build.sh --library
  <dir>` compiles a library's component codegen and its own C++ in, as React Native's Android
  build does (`codegen-library.sh`, `cmake/libraries.cmake`): `common/cpp`, or the one other folder
  holding `react/renderer/components/<name>` (react-native-gesture-handler's `shared/shadowNodes`),
  with each registered descriptor's header found by what it declares, whatever its file is named
  (react-native-keyboard-controller's `RNKC` prefix). The core reads a library's own props and
  state through `core/src/libraries/<name>.cpp`.

```sh
pnpm --filter @ng-native/desktop test:native   # the core and its tests, no Hermes, any OS
pnpm --filter @ng-native/desktop build:host     # the macOS host
```

## Publishing a prebuilt host

The release workflow (`.github/workflows/release.yml`) publishes one with each release, for the
React Native version the packages support:

1. Its `desktop-host` job builds the universal Release host against `examples/canary`, which has
   every host library, signs it ad hoc and packs it with
   `native/scripts/make-prebuilt.mjs examples/canary .prebuilt --version <release> --base-url <url>`,
   where `<url>` is the release's downloads URL.
2. The release job writes the host's entry, with its SHA-256, into `packages/desktop/prebuilt.json`
   before the packages are packed, so the npm package names the archive.
3. The archive goes up with the GitHub release.

To publish a host by hand, for another React Native version or another app, run `make-prebuilt.mjs`
with `--manifest prebuilt.json` to write its entry, commit `prebuilt.json`, and attach the archive
to the GitHub release at `<url>`.
