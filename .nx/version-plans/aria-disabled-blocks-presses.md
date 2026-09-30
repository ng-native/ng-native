---
__default__: patch
---

`aria-disabled` and `accessibilityState.disabled` now stop presses on `<touchable-opacity>` and a `pressable` `<text>`, as they do on React Native's `TouchableOpacity` and `Text`.

Until now only `disabled` stopped a press, and `aria-disabled` changed only what was announced. `disabled` still decides when it is set, so `[disabled]="false" [aria-disabled]="true"` still presses. A state contributed through `contributeAccessibility` counts the same way. `<pressable>` and a `PressBehavior` host are unchanged: as in React Native's `Pressable`, only `disabled` stops their presses.
