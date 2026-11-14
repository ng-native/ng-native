---
__default__: patch
---

`Updates` in `@ng-native/expo` adds `checkForAppUpdate()` and the `appUpdateAvailable` signal, for a whole-app updater: Sparkle in a macOS `dmg` build, through the desktop host. Elsewhere, in development, in `app` and `mas` builds, and on iOS, Android and the web, both are inert.
