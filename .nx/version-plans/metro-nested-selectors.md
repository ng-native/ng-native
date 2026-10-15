---
__default__: patch
---

An app's stylesheet compiles `:is()`, `:where()` and `:not()` of any selector, `:is(.a + .b)` and `:not(.list > *)` among them, and `:has()` of any relative selector, `:has(+ .next)`, `:has(~ .panel .mark)` and `:has(.row > .badge)` among them, where each was dropped with a warning. A `:has()` on a box before the styled element, `.card:has(.action) + .title`, is matched too, and so are Tailwind's `group-has-*` and `peer-has-*` variants. Each is as specific as in a browser, and a list that mixes such a selector with a compound keeps both.
