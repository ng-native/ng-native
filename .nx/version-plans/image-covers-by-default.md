---
__default__: minor
---

An `<image>` covers its box by default on iOS, Android, macOS and the web host, as React Native's `Image` does, where one with no `resizeMode` and no `object-fit` was stretched to fill it on iOS and macOS (Android already covered it). An image whose picture has different proportions from its box is now scaled to fill the box and cropped, not distorted: set `resizeMode="stretch"` (or `object-fit: fill`) on one that should stay stretched. An explicit `resizeMode`, or `object-fit` in a stylesheet, still wins.
