---
__default__: patch
---

On Android, the header's back arrow no longer leaves a screen whose page sets `preventNativeDismiss`: it fires `(nativeDismissCancelled)` and keeps the screen, as the Back button does.

Every screen is committed with react-native-screens' `nativeBackButtonDismissalEnabled` off, as react-navigation's native stack does, so the arrow reaches the router, which goes back as before for a screen that does not refuse. iOS is unchanged.
