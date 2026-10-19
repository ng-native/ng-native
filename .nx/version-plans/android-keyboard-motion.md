---
__default__: patch
---

`provideNativeKeyboard()` from `@ng-native/expo/keyboard` follows the keyboard on Android as it moves, from a native module of the package's own.

A `<keyboard-dock>` and the content its `[keyboardLift]` moves are moved on the native side at every
frame, by how far the keyboard covers the dock on screen, so a dock that is not at the bottom of the
window, or is in a form sheet react-native-screens raises with the keyboard, rises only as far as it
must, and one in a `<modal>` follows the modal's keyboard. A `<keyboard-avoiding-view>` follows the
keyboard frame by frame from the new `Keyboard.position`, where it jumped to its resting place
before, since Android animates no layout alongside the keyboard by default; `Keyboard.metrics`
carries the motion's duration there, with `'easeOut'`. The module applies no inset, so the app keeps
its edge-to-edge layout, in landscape too. Off Android, and in a build without the module, it
provides nothing.

`Keyboard.followsMotion` and `Keyboard.position` from `@ng-native/device` are new, as are
`KeyboardSource.subscribeMotion` and the `KEYBOARD_MOTION` token.
