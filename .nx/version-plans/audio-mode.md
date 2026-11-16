---
__default__: patch
---

Add `setAudioMode(mode)` to `@ng-native/expo/audio`: `expo-audio`'s `setAudioModeAsync` on iOS, Android and the web, and on macOS the desktop host's `NgNativeAudio`, which takes the mode and changes nothing, where calling `expo-audio`'s function directly throws. It does nothing where there is no such module.
