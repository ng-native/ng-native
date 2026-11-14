---
__default__: patch
---

On macOS `Sharing` answers from the desktop host's `NgNativeSharing` module, since React Native's `Share` rejects every call there. The desktop host does not have that module yet, so `Sharing.available()` is false on macOS, where it was true while every `share()` answered false.
