---
__default__: patch
---

On Android, the Back button now leaves a screen that sets `preventNativeDismiss` in place and fires its `(nativeDismissCancelled)`, as a swipe does on iOS, rather than dismissing it and losing its unsaved changes.

react-native-screens ignores `preventNativeDismiss` on Android and leaves Back to JavaScript, so the native stack outlet now refuses the press itself. `NativeNavigation.back()` is not refused, so a page can still leave once it has asked.
