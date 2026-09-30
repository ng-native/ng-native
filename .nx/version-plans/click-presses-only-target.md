---
__default__: patch
---

On Android, a keyboard or TalkBack click on a focusable view inside a pressable no longer presses the pressable, as in React Native.

A touchable now answers a click only when it is the view that was clicked. One the click merely bubbles through stops it there, as React Native's `Pressability` does, so a `(click)` listener on a view around a pressable no longer hears a click aimed at something inside it. To tell them apart, the event a listener receives now carries `target`, the node the event happened on, as React Native's does.
