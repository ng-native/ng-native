---
__default__: patch
---

`@expo/ui` draws on macOS: the desktop host implements each `ui-*` view in SwiftUI inside an NSHostingView, under the iOS names and with the iOS props and events, and `registerExpoUiViews('macos')` registers them. `ui-accessory-widget-background`, `ui-sync-toggle` and `ui-toolbar` are absent on macOS; `EXPO_UI_MACOS` in `@ng-native/expo` lists each iOS view with its SwiftUI view on macOS or the reason it is absent.
