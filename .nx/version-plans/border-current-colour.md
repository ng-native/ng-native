---
__default__: patch
---

A border shorthand with no colour, such as `border: 2px solid` or `border-top: 1px solid`, is now drawn in the element's text colour, as on the web, rather than in native's default black.

The colour is the element's own `color` or the one it inherits, and it follows that colour when it changes. A border colour of `currentColor` works the same way, where it was dropped with a build warning before: `border-color`, the per-side and logical longhands, Tailwind's `border-current` and `border-x-current`, and a `currentColor` written in a border shorthand beside a `var()`. Bootstrap's `.spinner-border` is drawn in its text colour as a result. A `border-width` with no colour anywhere is still drawn black, native's default, as the web host draws it.
