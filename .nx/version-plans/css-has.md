---
__default__: patch
---

`:has()` is supported on the node a rule styles, for a descendant (`.card:has(.action)`) or a child (`.card:has(> img)`), and Tailwind's `has-[...]` and `has-data-[...]` variants with it. The rule was dropped with a warning before. On an ancestor of the styled node (`group-has-*`), or with a longer or sibling selector inside, it still is.
