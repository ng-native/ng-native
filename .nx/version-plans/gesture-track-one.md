---
__default__: patch
---

`untrackedGesture()` from `@ng-native/components/gestures` keeps one gesture of a composed gesture out of interaction reports while the others are still reported, as in `Gesture.Race(Gesture.Tap(), untrackedGesture(Gesture.Pan()))`.

It returns the gesture it is given, and an untracked composed gesture keeps every gesture it is made of out. It is read when the gesture is attached to an element with `[gesture]` on iOS and Android, and like `[trackGesture]="false"` it adds no work when no interaction observer is registered.
