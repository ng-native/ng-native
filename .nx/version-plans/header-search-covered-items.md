---
__default__: patch
---

On Android a tap on an open `<native-search-bar>` no longer presses the `<native-header>` item hidden under it: while the field is open, the header's other `<native-header-item>`s take no touches.

react-native-screens hides those items when the field opens, but a hidden view keeps its bounds, and React Native's Android touch dispatch finds a target by bounds alone. The items' content now inherits `pointer-events: none` between the search bar's `topOpen` and `topClose`, so the props committed for that content change while the field is open, including an item added while it is open. Content that sets its own `pointer-events` to `auto` still takes touches. iOS sends no open or close and is unchanged.
