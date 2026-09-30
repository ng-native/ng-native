---
__default__: patch
---

On Android, a keyboard's Enter or D-pad centre and TalkBack's double-tap now fire `(press)` on `<pressable>`, `<touchable-opacity>`, a `pressable` `<text>` and a `PressBehavior` host, as they do in React Native.

Android activates a focused view with a click rather than a touch, and nothing handled it, so these controls could not be activated without touching the screen. The click fires `press` alone, with no `pressIn` or `pressOut`, as in React Native's `Pressability`. It is refused while the control would refuse a touch, and a pressable around the focused one does not also press. iOS and the web host are unchanged.
