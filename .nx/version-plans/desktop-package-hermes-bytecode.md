---
__default__: patch
---

`ng-native-desktop package` builds the macOS host as a Release build and ships the app's bundle as Hermes bytecode, compiled by the `hermesc` built from the host's own Hermes. It also makes the icon set's folder before `sips` writes the scaled icons, where an app with an image icon failed to package.
