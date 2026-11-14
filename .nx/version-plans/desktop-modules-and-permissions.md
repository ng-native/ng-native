---
__default__: patch
---

On macOS every `@ng-native/expo` service with a desktop source in v1 answers from the desktop host's TurboModule named after its Expo package (`NgNativeHaptics` for `expo-haptics`, `NgNativeSecureStore` for `expo-secure-store`, and so on, listed in `DESKTOP_MODULES`), and a desktop host without one throws `MissingModuleError` on first use, saying to rebuild it with `npm run macos`. Mobile-only services, such as sensors, brightness and orientation, stay absent. `macosPermissions(config)` in `@ng-native/device` reads a macOS build's usage strings and App Sandbox entitlements from the Expo keys an app sets for iOS: `ios.infoPlist`'s usage strings and each `expo-*` plugin's permission option.
