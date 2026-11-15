---
__default__: patch
---

`Notifications` in `@ng-native/expo` works on macOS: the notifications that arrive while the app runs and the ones the user clicks reach `latest` and `response`, and a date in a trigger crosses to the host as milliseconds. The Android channels, the categories and the push tokens have no macOS counterpart and answer empty or do nothing there.
