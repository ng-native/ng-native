---
'__default__': patch
---

On Android, an `<ng-icon>` that loses a `pointer-events` it had, such as one inherited from a `<virtual-list>` row that was parked and then reused, no longer stops the app with a NullPointerException in react-native-svg.

A `pointerEvents` that goes away is now committed as `auto` rather than `null`, on every view and on both platforms. React Native's own views already read a `null` as `auto`, so they behave as before; react-native-svg's Android root view called `toUpperCase` on the `null`.
