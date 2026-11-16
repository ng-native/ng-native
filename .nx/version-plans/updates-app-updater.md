---
__default__: patch
---

`Updates` in `@ng-native/expo` adds `checkForAppUpdate()` and the `appUpdateAvailable` signal, for a whole-app updater. In a macOS `dmg` build it is Sparkle, through the desktop host: `checkForAppUpdate()` shows Sparkle's check, and `appUpdateAvailable` follows what it has found. On iOS and Android `checkForAppUpdate()` opens the app's store page, from `ios.appStoreUrl` or `android.playStoreUrl` in the app config, and resolves `true`, or `false` when the config names none or `expo-updates` or `expo-store-review` is not installed; an app without `expo-store-review` still builds. `appUpdateAvailable` stays `false` on iOS and Android, as the stores give the app no way to ask. On macOS in development and in `app` and `mas` builds, and on the web, both are inert.
