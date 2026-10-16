---
'__default__': patch
---

A change under many `:has()` rules walks each box's subtree once for all the rules that box asks, and not again under a box above it already walked, where it walked it once for each rule, so an app with many such rules, as Tailwind's `has-[...]` variants and component libraries write them, opens a screen much faster.
