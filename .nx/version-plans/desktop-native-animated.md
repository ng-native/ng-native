---
__default__: patch
---

On macOS and Linux, the host now runs React Native's animated module, so a CSS animation or transition of `opacity` or `transform` that native can play runs on the host's display frames with no commit from JavaScript each frame.

iOS and Android already had it. A keyframes animation with a delay, or one that takes no time, still plays from JavaScript, as on iOS and Android. On Linux, 200 views turning and fading went from about two commits a frame to one when the animation starts. The engine's interpolation nodes now name their output type, which React Native's C++ animated module requires.
