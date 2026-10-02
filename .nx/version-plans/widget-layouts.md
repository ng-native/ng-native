---
__default__: minor
---

A Live Activity or home-screen widget is drawn from an Angular template: `createLiveActivity(name, widgetLayout(Layout))` takes a component whose template uses the `ui-*` views, and `@ng-native/metro` compiles it at build time to the source the widget extension runs, with no JSX and no React. The template is type-checked like any other, and anything the extension cannot run is a build error with its line and column. `@ng-native/expo/expo-ui-components` adds typed `UiZStack`, `UiRectangle`, `UiRoundedRectangle`, `UiUnevenRoundedRectangle`, `UiCapsule`, `UiCircle`, `UiEllipse`, `UiAccessoryWidgetBackground`, `UiLabel` and `UiLink`, for a layout and an app alike.
