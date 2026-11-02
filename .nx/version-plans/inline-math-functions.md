---
__default__: patch
---

Work out `calc()`, `min()`, `max()` and `clamp()` in a `style` attribute or a `[style]` binding as a stylesheet does, for lengths in `em` and viewport units, percentages, numbers and transform arguments.

A value set this way commits what a stylesheet commits for the same declaration where it was committed as text native drops, or dropped. That covers `opacity`, `flex-grow`, `flex-shrink`, `aspect-ratio`, a unitless `line-height`, `font-weight`, the `flex` shorthand, and the arguments of a transform. A `translateX(1em)` in a bound transform is measured against the font size in scope too.

A `calc()` of tokens set on an element now needs whitespace either side of `+` and `-`, as CSS does: `calc(var(--gap)+2px)` is invalid, so the declaration that reads it is unset. A `clamp()` inside one, with a `var()` in it, is read.

A value with a comparison only the box or the font size can settle, such as `min(50%, 100px)` or `min(1em, 20px)`, is left as written, and native drops it.
