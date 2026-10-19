---
__default__: patch
---

An app's stylesheet compiles `:is()`, `:where()` and `:not()` of any selector, and `:has()` of any relative selector, where each was dropped with a warning.

`:is(.a + .b)` and `:not(.list > *)` are among the first, `:has(+ .next)`, `:has(~ .panel .mark)`
and `:has(.row > .badge)` among the second. A `:has()` on a box before the styled element,
`.card:has(.action) + .title`, is matched too, and so are Tailwind's `group-has-*` and `peer-has-*`
variants. Each is as specific as in a browser, and a list that mixes such a selector with a compound
keeps both.
