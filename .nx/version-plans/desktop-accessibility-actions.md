---
__default__: patch
---

`(accessibilityAction)`, `(accessibilityTap)`, `(magicTap)` and `(accessibilityEscape)` now commit the `onAccessibilityAction`, `onAccessibilityTap`, `onAccessibilityMagicTap` and `onAccessibilityEscape` props React Native's iOS view checks before it sends them, so a declared custom action reaches its binding on iOS and macOS. On macOS a view's `accessibilityActions` are VoiceOver's actions: `activate` is its press, `increment` and `decrement` step an adjustable view, `escape` is its cancel, and the rest are custom actions by their label. VoiceOver's press, and Space or Return on a focused view, send the accessibility tap or `activate` when the view listens, and otherwise click the view, as iOS's synthesized tap does. `expanded` in `accessibilityState` (or `aria-expanded`) is reported to VoiceOver.
