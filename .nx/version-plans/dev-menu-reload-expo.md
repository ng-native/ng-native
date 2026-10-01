---
__default__: patch
---

`DevMenu.reload()` now reloads an Expo app in development through Expo's `reloadAppAsync()`, so an app in Expo Go comes back with Expo's native modules rather than failing with `Cannot find native module`.

It reloads the way Metro's own full reload does, through the Fast Refresh runtime that `@ng-native/platform` routes through Expo in an Expo app, falling back to React Native's reload with the error logged. `@ng-native/device` does not name `expo` for this, so a web build without Expo still resolves it. In a release build, and in an app without Expo, it is React Native's `DevSettings.reload()` as before.
