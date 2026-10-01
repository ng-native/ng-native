---
__default__: patch
---

`display: var(--d)` now reads its token on device, in a stylesheet or set on an element, where it was dropped with a build warning.

A token of `flex`, `none` or `contents` is that value, and one of `block`, `inline`, `inline-block`, `flow-root` or `inline-flex` is `flex`, as each is written out, in any case. A token that is none of these, or unset with no fallback, unsets `display`, as Chrome does: a weaker rule's `display: none` no longer applies.
