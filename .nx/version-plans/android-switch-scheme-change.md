---
__default__: patch
---

On Android, a `<switch>` on screen now follows a change of scheme, by the system's dark mode or by `ColorScheme.set` on Android 12 and later, once the app is rebuilt.

React Native's switch takes AppCompat's thumb and track tints from the theme once, when it is created, and an activity that handles `uiMode` itself, as Expo's does, keeps its views across the change, so the off track could vanish against the new background. The `NgNativeColorScheme` module now tints each AppCompat switch in the activity again after each configuration change it takes in place. A `thumbColor` or `trackColor` set on the switch is kept. A switch whose theme gives it drawables other than AppCompat's is left alone, as AppCompat never tinted those. Expo Go keeps the old behaviour.
