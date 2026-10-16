---
__default__: patch
---

On iOS, `ui-image`'s `size` and `color`, `ui-gauge`'s `type` and its three labels, `ui-label`'s `color`, and the `accessibilityLabel` of `ui-date-picker` and `ui-menu` now take effect in the app, where SwiftUI ignored them before.

SwiftUI's views read none of these as props, so each is now sent as `@expo/ui`'s own components send it. A `ui-image`'s `size` is a `font` modifier of that size (a `font` modifier in `modifiers` wins over it) and its `color` a `foregroundStyle` modifier. A `ui-gauge`'s `type` is a `gaugeStyle` modifier, and each label is a `ui-text` in the slot SwiftUI reads it from. A `ui-label`'s `color` draws its symbol as the label's icon in that colour. An `accessibilityLabel` is the `accessibilityLabel` modifier. Each is added after the `modifiers` given, so a committed `modifiers` list now includes them.

`ui-button` no longer sends `target` to native, which no `@expo/ui` button reads: a widget or Live Activity layout still compiles it as before. `ui-view-host` sends `modifiers` on Android only, as SwiftUI's view host has none.
