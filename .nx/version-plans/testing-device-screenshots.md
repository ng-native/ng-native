---
__default__: patch
---

Device tests can compare what the app drew with a reference screenshot: `await expect(node).toMatchScreenshot('name')` captures a node, a region of the window or `screen` (the whole window) on an iOS simulator or an Android emulator (Android 8 or later), and compares it with `__screenshots__/<test file>/<name>-<platform>.png` beside the test. A missing reference is recorded, except on CI; `-u` records them all again. The match is exact unless `comparatorOptions` (`threshold`, `allowedMismatchedPixels`, `allowedMismatchedPixelRatio`) say otherwise, in `deviceTests({ screenshots })` for the project or in the call.

The capture comes from a native module in `@ng-native/testing`, which the development build a run makes includes; a build made by hand needs rebuilding once after the upgrade. Expo Go and macOS do not have it, and a screenshot there fails with a message saying so.
