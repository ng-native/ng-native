---
__default__: patch
---

On macOS and Linux the desktop host draws `@react-native-masked-view/masked-view`'s view itself, so `<gradient-text>` shows its background through its letters instead of as a solid box.

The view's children draw through its first child, which is not drawn itself, as on iOS: a layer mask on macOS and a snapshot mask on Linux. `<masked-view>` is no longer reported absent on macOS, and `ng-native-desktop run` and `package` no longer list `@react-native-masked-view/masked-view` as having no desktop code.
