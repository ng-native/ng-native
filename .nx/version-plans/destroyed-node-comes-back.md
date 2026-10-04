---
__default__: patch
---

Content projected into an `@if` no longer aborts the app when the `@if` closes and opens again. Angular destroys the projected element with the view that showed it and puts the same element back later; the engine made the element's view again but handed it the views of what it holds, and native aborts when a view is given a second parent. Deleting past the start of a one-time code field built this way crashed on a device.
