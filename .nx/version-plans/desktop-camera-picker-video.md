---
__default__: patch
---

On macOS `ImagePicker.capture()` from `@ng-native/expo` records video in the desktop host's camera sheet when `mediaTypes` asks for videos.

With videos alone the sheet's shutter is Record, then Stop, with the time recorded beside it; with photos and videos it adds a Photo and Video switch, in photo mode first. The video is a QuickTime movie, not mirrored, recorded at `videoQuality` and stopped at `videoMaxDuration`, and is shaped as iOS shapes a recorded video: `type: 'video'`, a `.mov` `uri`, `width`, `height`, `duration` in milliseconds, `mimeType: 'video/quicktime'` and `fileSize`. A request for videos asks for the microphone when it has not been asked, and rejects with iOS's message when the microphone is refused or the app has no `NSMicrophoneUsageDescription`. A request whose `mediaTypes` is an empty list takes a photo, as on iOS. The sheet also shows when the app is not active, as just after the OS asked for the microphone.
