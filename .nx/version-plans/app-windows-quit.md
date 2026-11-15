---
__default__: patch
---

`AppWindows.quit()` in `@ng-native/device` starts quitting the app as Cmd-Q does on macOS: every window's `canClose` guard, then the `willQuit` handlers, then the app quits, and one guard that says no keeps it running. It does nothing on iOS and Android.
