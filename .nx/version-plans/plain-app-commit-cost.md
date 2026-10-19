---
__default__: patch
---

Creating, restyling and committing elements is faster for an app that uses none of block, grid, fixed or sticky layout, generated boxes, overflow scrollers, inline svg drawing or `:has()`, and costs about what it did in 0.16.0. An engine node is made with every field a commit writes to it, a prop or declaration set is no longer copied to look for a transition, a node's own style is read without being copied where no rule on it is `!important`, and the checks for those features are asked of each node without a call of their own. What is rendered does not change.
