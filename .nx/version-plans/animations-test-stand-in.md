---
__default__: patch
---

A component that imports Animated or AnimatedStyle from @ng-native/components/animations can be loaded in a Vitest test, where ngNative() now stands in for that entry point.

The stand-in is the browser build's Animated graph with no frames between: timing, spring and delay finish as soon as they start, the value is where the animation ends, and the end callback is called with finished set to true. Easing and the sequence and parallel composites behave as they do on a device, and the stand-in is also exported as @ng-native/components/stand-ins/animations.
