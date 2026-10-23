---
__default__: patch
---

On Android, a `<keyboard-avoiding-view>`, a `<keyboard-dock>` and a field focused with the keyboard up no longer come up short of the keyboard by the status bar's height where React Native's edge-to-edge flag is off, as in Expo Go.

React Native reports the keyboard's `screenY` from the top of the screen, and on Android without that flag measures a view from below the status bar. The three now take the bar's height off `screenY` before comparing the two, so an app that passed the status bar's height as `keyboardVerticalOffset` to make up for it should pass it no longer. iOS is unchanged. `Keyboard.windowTop` and `KeyboardSource.windowTop` from `@ng-native/device` are new.
