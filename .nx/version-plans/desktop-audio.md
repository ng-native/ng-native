---
__default__: patch
---

On macOS `audioPlayer` and `audioRecorder` from `@ng-native/expo/audio` answer from the desktop host's `NgNativeAudio`, over AVPlayer and AVAudioRecorder: a player loads a file, an http or https url or an asset, plays, pauses, seeks, and sets its rate, volume, mute and loop, and its state follows expo-audio's status events. A recorder takes the `ios` recording options and records once the microphone is allowed; without the permission, or on a Mac with no microphone, `prepareToRecordAsync()` rejects. Audio sampling and the lock screen controls do nothing on macOS.
