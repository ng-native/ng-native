---
__default__: patch
---

On Android, a keyboard or TalkBack click on a focusable view inside a pressable no longer presses the pressable, as in React Native.

A touchable now answers a click only when it is the view that was clicked. A touchable the click merely passes through stops it there, as React Native's `Pressability` does.

This is a behaviour change for apps: a `(click)` listener on a view around a pressable no longer hears a click aimed at something inside that pressable, such as a nested pressable or a focusable view, where until now it did. A click on the pressable itself, or anything with no pressable between it and the listener, still reaches the listener.

To tell them apart, the event a listener receives now carries `target`, the node the event happened on, as React Native's does.
