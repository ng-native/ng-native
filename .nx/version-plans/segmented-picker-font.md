---
'__default__': patch
---

A `font` modifier on a `ui-picker` with the segmented style draws its segments in that font on iOS, which SwiftUI's segmented picker otherwise ignores. `ui-picker` sends each `font` of a segmented picker again as a modifier `@ng-native/expo` registers with `@expo/ui`, which sets the title font on the picker's own `UISegmentedControl`, so a development build has to be rebuilt to pick it up. Expo Go cannot load it, and its segments stay in the system font.
