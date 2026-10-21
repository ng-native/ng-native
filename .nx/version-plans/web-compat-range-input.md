---
__default__: patch
---

In an app with `provideWebCompat()`, an `<input type="range">` keeps its value within its `min`, `max` and `step`, has `valueAsNumber`, `stepUp()` and `stepDown()`, and moves under a finger with `input` and `change` events, so Material's slider can be dragged.
