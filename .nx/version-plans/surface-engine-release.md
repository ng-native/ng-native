---
__default__: patch
---

An app's engine in `@ng-native/platform` is let go when the app is destroyed, as when Android recreates the activity after the font or display size changes, rather than kept for the rest of the app's life.

The old engine stayed joined to the runtime's shared event dispatcher, so it kept itself, its root and every view it had committed, and it was handed the events that have no target in place of the app that replaced it. It now leaves the dispatcher, cancels the frame and the timers it had asked for, and stops the animations and transitions native was playing for it, whose end callbacks native would otherwise go on holding, along with what native painted for it and the scroll-driven animations (`animation-timeline: scroll()`) it drove.

A closed window's engine does the same.

The dispatcher in `@ng-native/fabric` no longer keeps the first engine that joined it once that engine has left.
