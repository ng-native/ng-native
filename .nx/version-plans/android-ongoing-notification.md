---
'__default__': patch
---

`ongoingNotification()` from `@ng-native/expo/ongoing-notification` keeps an Android ongoing notification in step with a signal, with a timer Android counts itself, a progress bar and action buttons whose taps reach `onTaps` even when made while the app was not running; it asks Android to show it as a Live Update. It needs the app rebuilt (`npx expo run:android`, or a new EAS build). An Android app built with `@ng-native/expo` now declares the `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS` permissions, whether or not it shows one.
