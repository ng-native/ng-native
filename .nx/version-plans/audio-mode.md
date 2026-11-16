---
__default__: patch
---

Add `setAudioMode(mode)` to `@ng-native/expo/audio`: `expo-audio`'s `setAudioModeAsync` on iOS, Android and the web, and on macOS the desktop host's `NgNativeAudio`, which takes the mode and changes nothing, where calling `expo-audio`'s function directly throws. On macOS a host without `NgNativeAudio` rejects with `MissingModuleError`, saying to rebuild it, and where the platform has no audio module at all, such as in Node tests, it does nothing.
