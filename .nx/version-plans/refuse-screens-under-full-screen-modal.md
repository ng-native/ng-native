---
__default__: patch
---

On iOS, a navigation that would put a screen on a stack hidden behind a `fullScreenModal` another stack presents now resolves false and leaves the url and the screens as they were, where before it resolved true and showed nothing.

A screen a tab's own stack presents as `fullScreenModal` takes the app's stack out of the window, and react-native-screens' iOS stack makes no change while it is out of the window. So `present()` or `push()` of a top-level route, `present()` of a page of another tab, or a plain router navigation to such a route, from that modal, changed the url without showing the screen, and the next `back()` took off the screen nobody saw. These are now aborted before the url changes. A navigation inside the stack presenting the modal, to another tab, back to a screen still on the app's stack, or a `replace()` or `reset()`, goes ahead as before. Android is unchanged.
