---
'__default__': patch
---

A `ui-bottom-sheet` shows the system's close button on iOS: a `<ui-toolbar-item>` written inside it goes in a toolbar across the top of the sheet, and `<ui-button role="close">` in one is the button iOS 26 draws itself.

`@ng-native/expo` gains `UiNavigationStack`, `UiToolbar` and `UiToolbarItem` for SwiftUI's `NavigationStack`, `toolbar` and `ToolbarItem`, registered as `ui-navigation-stack`, `ui-toolbar` and `ui-toolbar-item`, and `UiButton`'s `role` takes `close`. They are iOS only and need `@expo/ui` 57.0.20 or later in the native build. Android's sheet has no toolbar and draws no item, and an iOS build without the views, as Expo Go can be, warns and shows the sheet without one.
