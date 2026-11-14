---
__default__: patch
---

On macOS `<expo-glass>` draws Liquid Glass (NSGlassEffectView) from macOS 26 and a frosted material before it, in the element's own corners. The desktop host's view registry reports `<refresh-control>`, `<input-accessory-view>`, react-native-keyboard-controller's views and the community `slider`, `picker` and `masked-view` absent on macOS, each a plain view there; the support table lists them, pointing at `@expo/ui`'s `ui-slider` and `ui-picker`.
