---
__default__: patch
---

`@ng-native/device` adds `NavigationBar`, a stack of claims on Android's navigation bar like `StatusBar`'s, with `set()`, `push()` and a `state` signal: `style` picks light or dark buttons for three-button navigation on Android 8 and later, or `'auto'` to follow `ColorScheme`, an in-app `ColorScheme.set()` included, and `hidden` hides the bar until a swipe shows it for a moment.

It drives `expo-navigation-bar`'s native module, reached by name: Expo Go has it, and a development build needs `npx expo install expo-navigation-bar`. Without the module, and on iOS, the web and in Node, claims are kept in `state` and change nothing. A fixed style is sent again on a scheme change, which resets the buttons on Android. On Android with the module, the native stack outlet from `@ng-native/router` puts a `hidden` claim on every screen without a `navigationBarHidden` of its own, as it does the status bar claim, since `react-native-screens` sets the bar's visibility from the screen in front each time one appears.

`@ng-native/fabric`'s `EngineNode` gains an optional `writes` set: a node that has one records which props have been written to it, which is how the outlet keeps a page's own `navigationBarHidden` that equals the carried claim.
