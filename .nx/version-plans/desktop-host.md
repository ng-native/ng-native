---
__default__: patch
---

`@ng-native/desktop` starts the macOS desktop host: React Native's C++ core and Hermes, built from pinned sources and linked statically, mounting an app's views into AppKit, with a toolkit-free core tested on Linux and macOS. `ng-native-desktop run <bundle>` builds the host into `~/Library/Caches/ng-native/desktop` the first time and opens a bundle file in a window, on macOS only. Bundle URLs are downloaded and opened from disk; there is no dev server, Fast Refresh, menu bar, scrolling or networking in the host yet.
