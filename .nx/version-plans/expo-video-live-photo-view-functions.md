---
__default__: patch
---

`<expo-video>` and `<expo-live-photo>` now have the view functions of `expo-video`'s and `expo-live-photo`'s React refs.

On `<expo-video>`, `enterFullscreen()`, `exitFullscreen()`, `startPictureInPicture()` and `stopPictureInPicture()` work on iOS and Android, and do nothing on macOS. On `<expo-live-photo>`, `startPlayback(style?)` and `stopPlayback()` work on iOS. Each returns a promise, and does nothing before the view is on screen.
