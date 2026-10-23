---
__default__: patch
---

A `<text-input>` moves its caret or selection to a bound `[selection]` on iOS and Android, on the first render and whenever the binding changes, where it went out only as a prop, which Android has no use for and iOS reads only as the field appears or its text is replaced.

As in React Native's `TextInput`, the selection is sent with the `setTextAndSelection` command whenever it differs from the one native last had, so a caret the user moves goes back to the bound selection, and a selection with no `end` is a caret at `start`, where iOS put the end at 0. A text set from code carries the bound selection with it. On Android, `(selectionChange)` now fires, as Android's field reports selection changes only when asked to, and `cursorColor` and `selectionHandleColor` follow `selectionColor` when they are not set, as React Native's do.
