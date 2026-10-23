---
__default__: minor
---

Under `provideWebCompat()`, an HTML element starts as a browser's own stylesheet has it: `position: static`, so an absolute element is placed against the nearest ancestor that says `relative` rather than against its parent, and, as a flex item, `flex-shrink: 1` with `min-width: auto` and `min-height: auto`, so it gives up room down to its content. A button's label is in the middle of its height until a stylesheet lays the button out. An app whose layout relied on every HTML element being a containing block, or on flex items never shrinking, should set `position: relative` or `flex-shrink: 0` where it needs them.
