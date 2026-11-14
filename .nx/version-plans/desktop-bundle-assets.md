---
__default__: patch
---

On macOS a bundle on disk finds its images: the desktop host gives React Native's `SourceCode` the bundle's path, where it gave nothing, so an image in a packaged app (or a bundle passed to `ng-native-desktop run`) loaded from `file://assets/...` and failed.
