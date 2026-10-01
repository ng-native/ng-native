---
__default__: patch
---

An outline or a background in `currentColor`, a `var()` that falls back to `currentColor` or holds it, a border width that is a `calc()` of a token, and `display: flow-root` now compile as in Chrome, where they were dropped with a build warning or, for a `var()`, silently.

- `outline: 2px solid`, `outline-color: currentColor` and `outline: var(--w) solid currentColor` draw the outline in the element's text colour, own or inherited.
- `background-color: currentColor` and `background: currentColor` paint the background in the text colour. That covers Bootstrap's `.spinner-grow` and `.placeholder`.
- `var(--c, currentColor)`, and a custom property set to `currentColor`, give a border, outline or background the text colour of the element using it, not the one that sets it. These dropped the colour without a warning before. On `color` itself it is the inherited colour.
- Each of these follows the text colour when it changes, as a border's `currentColor` already does.
- `border-top: calc(var(--bs-border-width) * 2) solid currentcolor`, Bootstrap's `.table-group-divider`, is drawn at the width the token works out to.
- `display: flow-root`, Tailwind's `flow-root`, is read as `flex`, as `block` is.
