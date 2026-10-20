---
__default__: patch
---

A `<style>` or constructed stylesheet made while the app runs draws `border`, its sides and parts, `outline` and each corner of `border-radius` as the build compiles them, where it drew no border at all.

A table's border is counted in its `clientWidth` and `clientHeight`, and its `clientTop` and `clientLeft` are 0, as in a browser.
