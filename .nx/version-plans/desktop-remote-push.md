---
__default__: patch
---

On macOS `Notifications.getDevicePushToken()` registers with APNs and answers the device token, a new token while the app runs reaches `devicePushToken()`, and remote notifications reach `latest()` and `response()` with their payload's data. `package` signs a `mas` build of an app that uses `expo-notifications` for APNs, and a `dmg` when `ios.entitlements['aps-environment']` is set.
