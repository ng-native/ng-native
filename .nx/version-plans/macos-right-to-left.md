---
__default__: patch
---

On macOS, an app's views now lay out right to left whenever `I18nManager.isRTL` is true (a right-to-left system language, unless the app calls `allowRTL(false)`, or `forceRTL(true)`), as on iOS, where they laid out left to right inside window chrome AppKit had mirrored.

In a right-to-left window `--safe-area-inset-titlebar-leading` measures the close, minimise and zoom buttons from the right edge, where AppKit puts them, and a secondary click on the back chevron, which a right-to-left toolbar puts on the right, lists the back history rather than the forward one.
