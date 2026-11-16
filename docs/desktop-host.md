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

Publishing one is a manual step; the release workflow does none of it:

1. Build and pack the host for each React Native version with:

   ```sh
   native/scripts/make-prebuilt.mjs <app> <out> --version <release> --base-url <url> \
     --manifest prebuilt.json
   ```

   `<url>` is the absolute URL of the GitHub release's downloads
   (`https://github.com/ng-native/ng-native/releases/download/<tag>`). It writes the archive to
   `<out>` and its entry into `prebuilt.json`.

2. Commit the updated `prebuilt.json`, so the npm package carries the entries.
3. Attach each archive to the GitHub release at that URL.
