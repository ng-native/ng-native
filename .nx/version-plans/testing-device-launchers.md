---
__default__: minor
---

`vitest --project ios` and `vitest --project android` start Metro, build the app's development build, boot the simulator or emulator and launch the app themselves, as `--project macos` starts the desktop host, so device tests run with one command locally and on CI.

The build is made the first time and kept in `node_modules/.cache/ng-native-device-tests` by the project's native fingerprint (`@expo/fingerprint`), so later runs take seconds and a CI job can cache it. `deviceTests({ device })` names the simulator (`iPhone 17 Pro`) or emulator (its AVD name), booted when it is not running; without it a run uses one that is running, or the newest iPhone or first emulator. Each launch starts the app with no data of an earlier one: reinstalled on a simulator, its data cleared on an emulator.

Before, an iOS or Android project waited for an app opened by hand, loading from a Metro started by hand. `deviceTests({ launch: false })` keeps that. A macOS run also starts its own Metro now, on a free port, instead of loading from the one on `RCT_METRO_PORT` or 8081; `deviceTests({ metroPort })` points a launched app at a Metro of your own.
