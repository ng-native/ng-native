---
__default__: patch
---

`@ng-native/desktop` is the macOS desktop host: React Native's C++ core and Hermes, built from pinned sources and linked statically, mounting an app's views into AppKit, with a toolkit-free core tested on Linux and macOS. `ng-native-desktop run`, on macOS only, builds the host into `~/Library/Caches/ng-native/desktop` the first time (or downloads a prebuilt one) and opens the app from the Expo dev server, with reload and Fast Refresh, or from a bundle path or URL.
