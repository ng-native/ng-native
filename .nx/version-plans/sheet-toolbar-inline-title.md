---
'__default__': patch
---

A `ui-bottom-sheet` with `ui-toolbar-item`s starts its content right under its bar on iOS, without the empty band of about 50pt SwiftUI left there for a large title. `@ng-native/expo` now registers a SwiftUI modifier of its own with `@expo/ui`, so a dev build has to be rebuilt to pick it up. Expo Go cannot load native code of its own, so a sheet there keeps the band.
