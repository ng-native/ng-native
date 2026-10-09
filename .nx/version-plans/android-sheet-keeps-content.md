---
'__default__': patch
---

On Android, a screen that is closed keeps its content while it animates away: a `formSheet` dismissed with `NativeNavigation.back()` or the system back button was emptied at once and slid away blank.

react-native-screens starts a removed screen's transition before its views are unmounted, from a listener its native module installs as it is made, and React Native makes a module only when JavaScript asks for it. Nothing asked, since none of react-native-screens' JavaScript is imported. `provideNativeRouter` now asks for it.
