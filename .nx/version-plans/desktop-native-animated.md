---
__default__: patch
---

On macOS and Linux, the host now runs React Native's animated module, so a CSS animation or transition of `opacity` or `transform` plays on the host's display frames with no commit from JavaScript each frame.

iOS and Android already had it. On Linux, 200 views turning and fading went from about two commits a frame to one when the animation starts. The engine's interpolation nodes now name their output type, which React Native's C++ animated module requires.
