---
__default__: patch
---

`UiViewHost` from `@ng-native/expo/expo-ui-components`, and the `<ui-view-host>` element `registerExpoUiViews()` now registers, hosts views of the app's own inside SwiftUI or Compose content, so a row drawn with the app's own components can be the trigger of a `UiContextMenu`: a long press lifts the row and opens the system menu, and the row still takes its own presses.
