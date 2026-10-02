---
__default__: minor
---

`@ng-native/expo/live-activity` keeps an iOS Live Activity in step with a signal: `liveActivity(factory, props)` starts it, updates the lock screen and the Dynamic Island whenever the signal changes, picks up an activity left running from before the app started, and ends it. The Live Activity comes from `expo-widgets`, with its layout written in `@expo/ui`. The padel example shows the score on the lock screen with it.
