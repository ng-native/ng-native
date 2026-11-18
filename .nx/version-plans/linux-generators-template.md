---
__default__: patch
---

The desktop template lists `linux` beside `macos` in its `app.json`, adds an `npm run linux` script and runs `node-macos` and `node-linux` under `npm test`; `nx g @ng-native/nx:desktop` and `ng generate @ng-native/schematics:desktop` add `linux` with a `linux` target beside `macos` and ignore `/dist/linux`, including to an app that has `macos` alone, and `--desktopOnly` apps list both. The Angular CLI's `expo` builder runs `ng-native-desktop` for a `linux` target and accepts `linux` as a `platform`, and its `vitest` builder takes several `project` names. The canary's Desktop screen names the OS it runs on and describes its menu and shortcuts for that OS.
