---
__default__: patch
---

A custom property set to a string in a stylesheet, such as `--d: "none"`, is now read as text rather than as the word in it, so `display: var(--d)` no longer hides the element and `color: var(--c)` with `--c: "red"` is no colour, as in Chrome; a quoted font family still names its family.
