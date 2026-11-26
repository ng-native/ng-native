---
__default__: minor
---

Prebuilt desktop hosts are now built for React Native 0.88.1 in place of 0.88.0, and `@ng-native/template-desktop` and desktop-only apps from the generators get 0.88.1, so a desktop app still on `react-native` 0.88.0 builds its host from source until it moves to 0.88.1.

The CLI takes a prebuilt host only for the exact React Native version an app has, and 0.88.1 changes JSI and the Hermes version, so a 0.88.0 host cannot run an app on it. To keep using a prebuilt host, run `npx expo install expo@~58.0.24`, then `npx expo install --fix`, which moves `react-native` to 0.88.1; an app that also runs on iOS then regenerates `ios/` with `npx expo prebuild -p ios --clean`. Until then, `ng-native-desktop` builds the macOS host from source, and a Linux host only on Linux of the architecture it is for. `make-prebuilt.mjs` takes `--react-native <version>` to build a host against a version the app does not have.
