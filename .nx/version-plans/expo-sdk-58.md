---
__default__: patch
---

The packages run on Expo SDK 58 (React Native 0.88, gesture-handler 3, Reanimated 4.7) as well as SDK 57, and the template stays on SDK 57.

- `@ng-native/expo` and `@ng-native/web-compat` accept the SDK 58 versions of the Expo modules they peer on, and `@ng-native/components` gesture-handler 3, so npm installs them beside an SDK 58 app.
- The `@ng-native/metro` config plugin no longer stops `expo prebuild` on SDK 58, whose template has a scene delegate of its own: it keeps Expo's, and installs the iOS 27 status bar fix from the app delegate instead. On SDK 57 it writes what it did before.
- `FileSystem.write` has written by the time it returns on SDK 58, where `File.write` answers a promise, by calling `writeSync`.
- `StatusBar`'s `backgroundColor` and `translucent` do nothing and warn once on React Native 0.88, which removed both setters, where they threw a `TypeError` on Android.
- Gestures attach with gesture-handler 3, which installs its bindings itself.
- The Metro preset resolves React Native's `NativeAnimatedHelper`, which sticky headers move through, by its file, so an app bundles on React Native 0.88 without a warning about that package's exports.
