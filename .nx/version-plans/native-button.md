---
__default__: patch
---

`@ng-native/components` has `<native-button>`, a platform button whose label is the text inside it, with `kind` (`default`, `cancel`, `destructive` or `plain`), `controlSize`, `sfSymbol`, `drawable`, `icon`, `[disabled]` and `(press)`. On macOS and iOS it commits the `NgNativeButton` view, which the macOS host draws as an NSButton; on Android it is a view pressed as a `<pressable>` is, and the web host draws an HTML `button`. `<switch>`, `<activity-indicator>`, and `@ng-native/expo`'s `<segmented-control>`, `<date-time-picker>` and `<search-field>` take `controlSize` (`mini`, `small`, `regular` or `large`), which `@ng-native/device` exports as the `ControlSize` type: AppKit's control sizes on macOS, and ignored on Android and the web. `@ng-native/eslint-plugin`'s `no-html-controls` names `<native-button>` for an HTML `<button>`.
