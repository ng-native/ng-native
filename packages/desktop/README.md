# @ng-native/desktop

The macOS desktop host for Angular Native: React Native's C++ core and Hermes, mounting an app's
views into AppKit, and the `ng-native-desktop` command that builds and launches it. You install the
package and never import it.

Alpha, and early: the host draws views, text and text fields and takes clicks and hover. It has no
dev server, menu bar, scrolling or networking yet.

## Run a bundle

```sh
npx ng-native-desktop run dist/main.hbc
```

Run it from the app's directory: the host is built against the app's own `react-native`
(0.88), the first time into `~/Library/Caches/ng-native/desktop/rn-<version>`, which takes a few
minutes and needs Xcode's command line tools, CMake and Ninja. Later runs reuse it. A bundle URL is
downloaded and opened from disk.

| Option            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `--module <name>` | The registered app to start. Default `main`.              |
| `--universal`     | Build for arm64 and x86_64. Default: this Mac's own arch. |

## Layout

- `native/core`: the toolkit-free C++ core (mounting, the view tree and hit testing, input and
  hover, text measurement, the module registry and desktop view props), with tests on an in-memory
  backend that run on Linux and macOS.
- `native/appkit`: the AppKit backend and the `ngn-macos` binary.
- `native/scripts`: fetching the pinned sources, building Hermes and building the host.
  `NGN_DESKTOP_CACHE` moves the cache and `NGN_JOBS` caps parallel compiles.

```sh
pnpm --filter @ng-native/desktop test:native   # the core and its tests, no Hermes, any OS
pnpm --filter @ng-native/desktop build:host     # the macOS host
```
