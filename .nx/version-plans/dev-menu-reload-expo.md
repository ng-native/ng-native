---
__default__: patch
---

`DevMenu.reload()` now reloads an Expo app through Expo's `reloadAppAsync()`, so an app in Expo Go comes back with Expo's native modules rather than failing with `Cannot find native module`.

React Native's `DevSettings.reload()` brought an app in Expo Go back without them until Expo Go was relaunched, as Metro's own reload did before. A reload Expo cannot do falls back to React Native's, with the error logged, and an app without Expo reloads through React Native as before.
