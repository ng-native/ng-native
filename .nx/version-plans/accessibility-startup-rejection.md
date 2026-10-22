---
'__default__': patch
---

A failed startup read of the accessibility settings in `@ng-native/device` no longer leaves an unhandled promise rejection, and `watchConditions` no longer tells the engine about reduced motion after its unsubscribe has been called. `Accessibility` and `watchConditions` keep the neutral settings when the read fails, and the change events still correct them.
