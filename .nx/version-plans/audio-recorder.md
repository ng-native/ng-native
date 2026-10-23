---
__default__: patch
---

`audioRecorder()` from `@ng-native/expo/audio` records with `expo-audio`: a recorder owned by the component that makes it, released when it is destroyed, with its `getStatus()` as a `state` signal, as `useAudioRecorder` and `useAudioRecorderState` give a React component.

The recorder is made with the options merged for the platform, as `useAudioRecorder` makes it, so `metering` works on Android, which reads `isMeteringEnabled` only from those. The player page also shows `expo-audio`'s `setAudioModeAsync({ playsInSilentMode: true })`, which an app calls directly to play with the iOS silent switch on.
