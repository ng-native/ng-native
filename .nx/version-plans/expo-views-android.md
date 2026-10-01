---
__default__: patch
---

Expo views now send their events on Android, and `@expo/ui` controls draw there.

No Expo view sent an event on Android: Android sends a view's events only once its config has been asked for, which `@expo/ui`'s and every Expo package's own React components do through `requireNativeView`, and `registerExpoView` did not. It now does, for every view it registers, so this covers `expo-maps`, `expo-camera`, `expo-image` and the rest as well as `@expo/ui`. And `<ui-host>` committed as `RNHostView` on Android, the bridge for React Native content inside Compose, so no `@expo/ui` control drew: it is `HostView` now, as `@expo/ui`'s own `Host` is.
