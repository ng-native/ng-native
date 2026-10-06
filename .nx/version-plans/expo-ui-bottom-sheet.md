---
'__default__': patch
---

`UiBottomSheet` in `@ng-native/expo/expo-ui-components` opens the system's sheet from any component, with no route: `<ui-bottom-sheet [(open)]="open" fitToContents>` is SwiftUI's sheet on iOS and Material's on Android, and what is written inside it is the app's own components.

It type-checks in a strict template, where `<ui-bottom-sheet>` on its own is an unknown element. `open` presents and dismisses the sheet and is written back when the user dismisses it, `dismissed` is emitted once the sheet has finished closing, `fitToContents` makes it as tall as its content rather than resting at half height, and `showDragIndicator` hides the grabber. The component mounts the sheet as each platform needs and wraps the content in the `ui-host` and `ui-view-host` a sheet's content takes, at the window's width.

`registerExpoUiViews` now also registers the sheet's native view as `ui-bottom-sheet-view`, the name the component's template uses. `<ui-bottom-sheet>` in a template that does not import `UiBottomSheet` is the native view, as before.

`UiGroup` types SwiftUI's `Group` (`<ui-group>`, iOS only), which carries modifiers for the views inside it.
