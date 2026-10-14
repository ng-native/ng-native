---
'__default__': patch
---

An icon or drawing whose shape has an `opacity` or `clip-rule` attribute no longer stops the app on Android: a shape's `propList` now names only the fill and stroke paint react-native-svg inherits, which Android reads each name of by reflection.
