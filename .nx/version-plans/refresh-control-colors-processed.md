---
'__default__': patch
---

`<refresh-control [colors]>` reaches Android as colours native reads, each entry through `processColor` as React Native's `processColorArray` does, where the strings were sent as written.

An entry with no colour is sent as transparent, as React Native sends it. `<expo-symbol [colors]>` takes the same path, as Expo's own `SymbolView` processes its palette on iOS.
