---
title: Back and forward
summary: The back and forward history each desktop window keeps, and the inputs that move it.
---

# Back and forward

On a desktop OS each window keeps a back and forward history, as a browser or Finder does.
`NavigationHistory.for()` is the main window's, and `for('preferences')` a route window's.

```ts
const history = inject(NavigationHistory).for();
history.canGoBack(); // a signal
await history.back();
```

The history spans every change of the window's outlet, a sidebar item chosen included, so Back
crosses back into the item before. A new navigation clears the entries ahead.

A page left behind is destroyed, so `forward()` builds it again from its URL, as a browser does
without a back-forward cache: its scroll position and form state are not kept. History is not
restored on relaunch, and a route window's history goes when the window closes.

The OS's own inputs move through the history of the window they are in: View > Back and Forward
with Cmd-[ and Cmd-] on macOS (Alt-Left and Alt-Right on other OSes), a two-finger swipe, and mouse
buttons 4 and 5. `backMenu()` and `forwardMenu()` list the entries behind and ahead, nearest first,
as menu items, which is what a long press on the back and forward chevrons shows.

On iPhone, iPadOS and Android each tab keeps its own stack, and the native back button and gesture
pop it; this history is not used there.

## Reference

<!-- api: NavigationHistory -->
