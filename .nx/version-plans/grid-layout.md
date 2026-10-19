---
__default__: patch
---

`display: grid` is laid out, following CSS Grid Level 1, and Tailwind's grid utilities compile where they were dropped with a warning.

Track lists take lengths, percentages, `fr`, `auto`, `min-content`, `max-content`, `minmax()`, `fit-content()` and `repeat()`. Items are placed by line number, by `span`, and by the names of lines and of `grid-template-areas`, in the order `order` gives. Gaps, alignment (baselines included) and `aspect-ratio` on a grid or an item are supported. A percentage `margin-top` or `margin-bottom` is a share of the item's area width. A grid keeps its own width, honours `min-width`, `max-width`, `min-height` and `max-height` on its tracks, and shrinks and stretches in a flex container as a box does. `inline-grid` sits in a line as `inline-block` does. A grid item's size or margin that is a `calc()` of a percentage and a length is of its area. Yoga has no grid, so the engine reads sizes back from native and places the items itself, in the commit that changed the grid. `subgrid` and the `grid` and `grid-template` shorthands are still dropped with a warning.
