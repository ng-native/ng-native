---
__default__: patch
---

A pushed screen on iOS can now be swiped back, which it could not because the native stack received a swipe-back area of 0 points on every edge.

The stack now sends react-native-screens' default of no limit for every edge of `gestureResponseDistance`, merged with any edge a screen's `presentation` sets.
