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

Linux has no backend yet. There `build.sh --backend none --runtime --test` builds the core, Hermes
and the runtime half and runs the core and runtime tests. Off macOS, Hermes links ICU 77.1, which
`fetch.sh` pins and `build-icu.sh` builds statically, with only English data
(`icu-filter.json`). The build runs in `native/docker/Dockerfile`, an AlmaLinux 9 image with clang
and lld from `llvm-toolset`. Building against el9 keeps the glibc it needs at 2.34, which
`native/docker/glibc-floor.sh` checks. CI's `host-linux` job runs this on x86_64 and arm64. On a
Mac, run the same image with Docker, as a user other than root, since root reads a file whatever
its mode and so fails the core tests that make one unreadable. The commands are in the
Dockerfile's header.

`ng-native-desktop run` builds the host with `--no-tests` and `package` with `--release`: the
published package has none of the core tests' sources, so only `test:native` and `build:host` in
this repository build them.

## Publishing a prebuilt host

The release workflow (`.github/workflows/release.yml`) publishes two with each release, for the
React Native version the packages support: the `debug` host, the dev build (`build.sh --universal
--no-tests`) with React Native's debugger, which `run` downloads, and the `release` host, the
Release build (`build.sh --universal --release`), which `package` downloads.

1. Its `desktop-host` job, once per flavour, builds the universal host against `examples/canary`,
   which has every host library but `react-native-webview` (an app with it builds the host from
   source), signs it ad hoc and packs it with
   `native/scripts/make-prebuilt.mjs examples/canary .prebuilt --flavour <flavour> --version <release> --base-url <url>`,
   where `<url>` is the release's downloads URL. The entry goes into
   `.prebuilt/prebuilt-host-<flavour>.json`.
2. The release job writes both entries, each with its flavour and SHA-256, into
   `packages/desktop/prebuilt.json` before the packages are packed, so the npm package names both
   archives. It stops when either is missing.
3. Both archives go up with the GitHub release.

A host is built only when something it is built from changed. `make-prebuilt.mjs --print-key`
computes the key of its inputs: the host's native sources and build scripts, React Native's and
each compiled-in library's version, the flavour, the compiler, the SDK and the signing identity.
Each entry in `prebuilt.json` records it as `inputs`. The job, through
`.github/actions/desktop-prebuilt`, then takes the first of these that applies:

- The last release's entry in the checked-out `prebuilt.json` has the same key: `--reuse`
  downloads its archive, checks it against the entry's SHA-256 and publishes it again, byte for
  byte, under the new release's name.
- An Actions cache holds a host built from the same key: `--host-cache` strips, signs and packs it.
  Every file is checked against the digest saved with it.
- Otherwise it builds, with ccache, the universal Hermes and the fetched sources restored, and
  keeps the unsigned host in the Actions cache under its key.

A key that cannot be computed, a failed download, a checksum that does not match or a cached file
that changed falls through to the next, and the last always builds. The Desktop host workflow's
`prebuilt-host` job runs the same action on a push to `main` that changed the host's inputs, so a
release finds those caches warm.

`prebuilt.json` holds one entry per React Native version and flavour:

```json
{
  "version": 1,
  "hosts": [
    {
      "reactNative": "0.88.0",
      "flavour": "debug",
      "url": "https://github.com/ng-native/ng-native/releases/download/v<release>/ng-native-desktop-host-<release>-rn-0.88.0-macos-universal-debug.tar.gz",
      "sha256": "<64 hex digits>",
      "libraries": { "react-native-screens": "<version>" },
      "inputs": "<64 hex digits>"
    },
    {
      "reactNative": "0.88.0",
      "flavour": "release",
      "url": "https://github.com/ng-native/ng-native/releases/download/v<release>/ng-native-desktop-host-<release>-rn-0.88.0-macos-universal.tar.gz",
      "sha256": "<64 hex digits>",
      "libraries": { "react-native-screens": "<version>" }
    }
  ]
}
```

An entry with no `flavour` is a release host. A command with no entry of its flavour builds the
host from source.

To publish a host by hand, for another React Native version or another app, run `make-prebuilt.mjs`
with `--flavour`, and `--manifest prebuilt.json` to write its entry, for each flavour, commit
`prebuilt.json`, and attach both archives to the GitHub release at `<url>`.
