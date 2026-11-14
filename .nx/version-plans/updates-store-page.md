---
__default__: patch
---

`Updates.checkForAppUpdate()` in `@ng-native/expo` opens the app's store page on iOS and Android, from `ios.appStoreUrl` or `android.playStoreUrl` in the app config, and resolves `true`, or `false` when the config names none. It needs `expo-store-review`. `appUpdateAvailable` stays `false` on both, as the stores give the app no way to ask.
