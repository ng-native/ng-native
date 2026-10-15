---
'__default__': patch
---

A change under many `:has()` rules restyles in one walk of the tree, where it walked the tree once for each rule, so an app with many such rules, as Tailwind's `has-[...]` variants and component libraries write them, opens a screen much faster.
