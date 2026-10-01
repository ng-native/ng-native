---
__default__: minor
---

`@ng-native/expo/foldable` reads the hinge of a foldable device, an iPhone Duo or an Android foldable, through `expo-foldables`: `Foldable` has the posture, the hinge angle and where the fold crosses the window as signals, with `separating`, `book` and `tabletop` derived from them. `examples/foldbook` is a reader built on it. `expo-foldables` is an optional peer, and on a phone with no hinge `Foldable` answers like a phone that does not fold.
