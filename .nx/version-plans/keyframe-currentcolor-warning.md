---
__default__: patch
---

The build warning for `currentColor` on a property other than `color` in a `@keyframes` frame now says `currentColor` is the cause, where it blamed `var()`, `em` and viewport units.
