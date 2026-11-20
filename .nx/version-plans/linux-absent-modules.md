---
__default__: patch
---

On Linux, a service the desktop host has nothing to stand on for (Haptics, Biometrics, Calendar, ImagePicker, MediaLibrary, SplashScreen, LanguageModel, Tracking, AppleSignIn, TextRecognition and Sharing) is absent: `available()` is false and each call does nothing (except what asks `LanguageModel` for an answer: `generate()` and `generateObject()` reject with `LanguageModelUnavailableError`, a turn of `session()` is refused the same way, and `stream()` returns a stream that has failed), where the host used to crash on first use. `audioPlayer()` and `videoPlayer()` throw that the module is not available on Linux. The desktop host registers a module only when its backend gives it a source, and names the rest in a new `NgNativeHost` module, so a module left out by design is never mistaken for a host to rebuild.

On Linux, `Notifications.getDevicePushToken()` answers null and `unregister()` does nothing, since the host has no push service.
