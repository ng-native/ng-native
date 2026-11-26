---
__default__: patch
---

`<expo-video>` and `<expo-live-photo>` now have the view functions of `expo-video`'s and `expo-live-photo`'s React refs.

On `<expo-video>`, `enterFullscreen()`, `exitFullscreen()` and `startPictureInPicture()` work on iOS and Android, and `stopPictureInPicture()` on iOS, where `expo-video` has it. Each does nothing on macOS. Picture in picture needs `allowsPictureInPicture` and the config plugin's `supportsPictureInPicture`, and on Android a device that supports it. On `<expo-live-photo>`, `startPlayback(style?)`, `full` unless set, and `stopPlayback()` work on iOS. Each returns a promise, and does nothing before the view is on screen.
