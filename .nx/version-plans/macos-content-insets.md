---
__default__: patch
---

On macOS, `native-stack-outlet` from `@ng-native/router` puts a screen's content in a safe area view, as on iOS 26, since a window's content runs under its title bar and toolbar. `<safe-area-provider>` from `@ng-native/components` publishes `--safe-area-inset-titlebar-leading`, the width of a macOS window's title bar buttons where content runs beside them, and `0px` elsewhere.
