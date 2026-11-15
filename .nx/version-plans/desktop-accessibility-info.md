---
__default__: patch
---

On macOS, `AccessibilityInfo` answers from the system: whether VoiceOver is running, reduce motion, reduce transparency, invert colours and increase contrast (`isDarkerSystemColorsEnabled`), with their change events as the setting changes. `Accessibility.screenReader` and `reduceMotion` from `@ng-native/device`, and `@media (prefers-reduced-motion)`, follow them. macOS has no bold-text or grayscale setting an app can read, so those answer false.
