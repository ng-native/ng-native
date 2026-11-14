---
__default__: patch
---

`nx g @ng-native/nx:app --desktopOnly`, `ng add @ng-native/schematics --desktop-only` and `ng generate @ng-native/schematics:application --desktop-only` make a macOS-only app from the desktop template: `macos` alone in `expo.platforms`, its sidebar and menu bar starter screen, and `macos` and `package` targets. `nx g @ng-native/nx:init --desktopOnly` makes it the default of the `application` generator in `nx.json`.
