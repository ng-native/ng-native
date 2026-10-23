---
'__default__': patch
---

`provideWebCompat()` in `@ng-native/web-compat` ends the window at the keyboard's top as the app's window measures it, taking `Keyboard.windowTop` off the keyboard's `screenY` as the keyboard-aware components do. On Android with React Native's edge-to-edge flag off, as in Expo Go, `innerHeight` was the status bar's height too tall while the keyboard was up, so an overlay placed from the window's bottom sat that far behind the keyboard.
