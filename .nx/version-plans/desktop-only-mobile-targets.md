---
__default__: patch
---

A desktop-only app from `nx g @ng-native/nx:app --desktopOnly` no longer shows the `run-ios` and `run-android` targets `@nx/expo`'s plugin inferred for it, and the new `nx g @ng-native/nx:mobile <app>` and `ng generate @ng-native/schematics:mobile <app>` add iOS and Android back to a desktop-only app.

The application generator adds a desktop-only app's directory to the `exclude` list of each `@nx/expo/plugin` registration in `nx.json`, and writes the two inferred targets that still apply on macOS, `export` and `install`, in its `project.json`; `prebuild` and the EAS `build` and `submit` targets are no longer inferred for it. Apps generated before this keep the inferred targets until their directory is added to that list by hand.

The `mobile` generator and schematic add `ios` and `android` to `expo.platforms` beside `macos`, the phone settings a mobile app's `app.json` has (portrait orientation, `ios.supportsTablet` and `android.package`), and `expo-status-bar` and `expo-system-ui`. The Nx generator removes the app from the plugin's `exclude` list, so `run-ios` and `run-android` are inferred again, or writes them on the app's own Metro port when it is not Expo's default; the schematic adds `run-ios` and `run-android` on the `expo` builder. Running either again changes nothing.
