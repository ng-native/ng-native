---
__default__: patch
---

`color: currentColor` is now the colour the element inherits, as in Chrome, where it was dropped with a build warning.

It follows the inherited colour when that changes, and passes it on to the element's children. A custom property set to `currentColor` and read by `color`, in a stylesheet or with `setCustomProperty`, already gave the inherited colour.
