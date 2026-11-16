---
__default__: patch
---

`ng-native-desktop package` packages the app with a Release build of the macOS host, the prebuilt one when it fits the app or one it builds, and ships the app's bundle as Hermes bytecode, compiled by the `hermesc` built from that host's own Hermes.
