---
__default__: patch
---

On an iPad with a hardware keyboard, a `<pressable>`, a `<touchable-opacity>` and any view with `[focusable]="true"` take the keyboard's focus with UIKit's focus halo, and Space or Return presses the focused one, a `[menu]` included, where React Native's iOS views take no keyboard focus.

Needs `@ng-native/components`' pod: the views report themselves to its `NgNativeKeyboardFocus` module, which Expo Go does not have. Tab moves the focus between focus groups and the arrow keys within one, as in other iPad apps. A disabled view is not focused. A press sends the touch a tap at the view's middle would, so `(press)` and `(pressIn)` fire as for a tap. Full Keyboard Access, which moves the focus by its own rules, is not covered.
