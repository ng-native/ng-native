---
__default__: patch
---

`ng-native-desktop package` packages an app whose bundle has no assets: `hermesc` now compiles the bytecode bundle in the staging folder, which is then copied into the app's `Contents/Resources`. Before, it wrote into `Resources`, which nothing had created for such an app, and stopped with "hermesc could not compile the bundle to Hermes bytecode".
