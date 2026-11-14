---
__default__: patch
---

On macOS a `<ui-bottom-sheet>` (`@ng-native/expo`) presents as the SwiftUI sheet the desktop host draws, as on iOS, where it drew nothing, and a sheet with detents opens at its smallest detent's height in the window, as a macOS sheet has no detents.
