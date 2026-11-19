---
__default__: patch
---

An app's engine in `@ng-native/platform` leaves the runtime's shared event dispatcher when the app is destroyed, as when Android recreates the activity after the font or display size changes, and cancels the frame and the timer it had asked for. The old engine stayed joined, so it kept itself, its root and every view it had committed, and it was handed the events that have no target in place of the app that replaced it. A closed window's engine cancels its frame and timer too. The dispatcher in `@ng-native/fabric` no longer keeps the first engine that joined it once that engine has left.
