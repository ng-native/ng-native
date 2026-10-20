---
__default__: patch
---

A `<style>` or constructed stylesheet made while the app runs draws `border`, its sides and parts, `outline`, `outline-offset` and each corner of `border-radius`, where it drew no border at all.

A token in a border or outline, `border: 1px solid var(--c)`, is filled in where the rule applies, and `CSS.supports` answers true for one.

A token and a plain declaration in one rule are applied in the order they are written, so `padding: var(--p); padding-top: 2px` pads the top by 2.

A box whose display is `table` counts its border in its `clientWidth` and `clientHeight`, and in the bounds of an `IntersectionObserver` it is the root of, as Chrome does.
