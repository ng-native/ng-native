---
__default__: patch
---

`screenshot()`, `toMatchScreenshot()`, `toHaveColorAt()` and `colorsAt()` now work in device tests on macOS: the desktop host has the `NgNativeTesting` module, which draws the app's window in process and asks for no screen recording permission. Where the module is missing, the error now says to update `@ng-native/desktop` on macOS, and that the Linux host does not have it yet, instead of telling you to rebuild a development build.
