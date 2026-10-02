---
__default__: patch
---

A custom property set on an element, `[style.--t]`, now has only CSS whitespace trimmed from its value, as Chrome does, so a no-break space or another Unicode space is kept, and `none` or `4px` with a no-break space before it is no longer read as `none` or `4px`.

CSS whitespace is a space, a tab, a newline, a carriage return and a form feed. The same holds between colour channels set on an element: `1 0 0` separated by no-break spaces is no longer read as `rgb(1, 0, 0)`. A declaration using such a token is unset, as it is in Chrome.
