---
__default__: patch
---

`display: grid` is laid out, following CSS Grid Level 1: track lists with lengths, percentages, `fr`, `auto`, `min-content`, `max-content`, `minmax()`, `fit-content()` and `repeat()`; placement by line number, by `span`, and by the names of lines and of `grid-template-areas`; gaps and alignment, baselines included; and items kept to an `aspect-ratio`. `inline-grid` sits in a line as `inline-block` does. A grid item's size or margin that is a `calc()` of a percentage and a length is of its area, and a grid in a box such a sum sizes is laid out at the size the box comes to. Tailwind's `grid`, `grid-cols-*`, `col-span-*`, `row-span-*`, `auto-rows-*`, `justify-items-*`, `place-items-*` and the rest compile where they were dropped with a warning. Yoga has no grid, so the engine reads sizes back from native and places the items itself, in the commit that changed the grid. `subgrid` and the `grid` and `grid-template` shorthands are still dropped with a warning.
