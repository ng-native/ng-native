---
__default__: patch
---

New package `@ng-native/firebase-messaging`: a `FirebaseMessaging` service that registers the app's Firebase Installation ID with FCM and answers it, for a backend that sends through FCM's HTTP v1 API with the `fid` target.

`register()` asks for the notification permission, registers with FCM (on iOS with the APNs token from `Notifications`) and sets `installationId`; after that, it registers again when the push token rolls while the app runs. Its config plugin turns on registration by installation ID on iOS and Android, turns off Firebase's app delegate proxy on iOS and gives the `GoogleUtilities` pod modules in the Podfile. Firebase's config files are Expo's `ios.googleServicesFile` and `android.googleServicesFile`. It needs a development build: in Expo Go, on the web host and in tests every call answers null.
