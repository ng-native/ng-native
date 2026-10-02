---
__default__: patch
---

`color: inherit`, `color: currentColor` inside `@keyframes` and `text-decoration-color: currentColor` now compile as in Chrome, where they were dropped with a build warning.

- `color: inherit` and `color: unset` are the colour the element inherits, as `color: currentColor` already is, and they follow it when it changes. Tailwind's `text-inherit` and v3's `placeholder-inherit` compile as a result. Every other CSS-wide keyword is still dropped with a warning.
- `color: currentColor` or `color: inherit` in a keyframe animates from or to the colour the element inherits, and follows it if it changes while the animation plays or is paused. `currentColor` on any other property in a keyframe is still dropped with a warning.
- `text-decoration-color: currentColor` is the element's text colour, own or inherited, and follows it when it changes.
