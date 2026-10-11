---
'__default__': patch
---

`pushToStartToken()` from `@ng-native/expo/live-activity` is the token a server starts a Live Activity with over APNs while the app is closed: a signal, null until iOS issues one. It needs iOS 17.2 and `enablePushNotifications` in the `expo-widgets` plugin's config.
