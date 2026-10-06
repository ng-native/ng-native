---
'__default__': patch
---

A `flex-basis` that changes after a view is first laid out is followed, and a percentage `flex-basis` follows the box it is a share of.

React Native works a `flexBasis` out once for a view and never again when its props change, so a bar bound from `flex-basis: 100%` to `60%` stayed at full width. A `flex-basis` that is a length or a percentage is now committed as the size it is along its container's main axis, a `width` in a row and a `height` in a column, which React Native reads on every layout and takes as the basis. A basis of `0` (`flex: 1`) and `auto` are committed as before. A view reading its committed props sees `width` or `height` where it saw `flexBasis`.
