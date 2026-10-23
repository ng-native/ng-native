---
'__default__': patch
---

On iOS, a sideways swipe on a `ui-swipe-actions` row of `@ng-native/expo` no longer presses a `pressable` inside the row's `ui-view-host`, and the responder system of `@ng-native/fabric` now asks `onMoveShouldSetResponderCapture` and `onMoveShouldSetResponder` on every move while a node holds the touch, as React Native does, so a node above the responder can take a drag from it.

The row takes a drag once the finger has moved 20 points sideways, and further sideways than down. A pressable that gives up the touch is told it was terminated, so it does not press; one with `cancelable` false keeps the touch and presses as before. A tap, and a drag mostly down the row, still press. Only the nodes above the responder are asked, from the lowest node above both it and the moving finger's target; the responder answering yes keeps the touch.
