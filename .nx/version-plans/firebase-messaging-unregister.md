---
__default__: patch
---

`FirebaseMessaging.unregister()` in `@ng-native/firebase-messaging` deletes the app's Firebase installation, so FCM answers `UNREGISTERED` for its FID, sets `installationId` to null, and stops re-registering on a token roll and re-reading the FID on coming back to the front until `register()` runs again. Call it on sign-out when pushes belong to the signed-in user.

On Android, a call without `google-services.json` in the app now rejects with `ERR_NO_FIREBASE_CONFIG`, as on iOS, rather than a generic error. `FirebaseMessaging` reads nothing from `Notifications` until `register()` runs, so a test that fakes `Notifications` without `devicePushToken` can inject it. The docs show an `app.config.js` that leaves out a missing Firebase config file, so prebuild works without one.
