---
__default__: patch
---

Add `cameraPermission()` and `microphonePermission()` to `@ng-native/expo/camera`, and `recordingPermission()` to `@ng-native/expo/audio`. Each returns a `Permission`, with `status()`, `granted()` and `blocked()` as signals and `check()`, `request()` and `ensure()`, that checks a refusal again when the app comes back to the front. On iOS and Android they call `expo-camera`'s and `expo-audio`'s own permission functions (`expo-audio`'s on the web too), and on macOS the desktop host's `NgNativeCamera` and `NgNativeAudio`, where calling `expo-camera` and `expo-audio` directly throws. Where the platform has no such module, as in a Node test, each answers denied; a build missing the module throws `MissingModuleError` on first use.
