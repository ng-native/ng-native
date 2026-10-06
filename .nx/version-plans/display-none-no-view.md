---
__default__: minor
---

An element that is `display: none` has no native view, nor has anything inside it; before, its views stayed mounted and were not displayed.

What a view holds of its own, such as a scroll offset, is no longer kept across a spell of `display: none`: the views are made again when the element is displayed. To keep a view while it is out of sight, take it out of the flow and give it no opacity (`position: absolute; opacity: 0; pointer-events: none`), which is how `<virtual-list>` now keeps its recycled rows. A debug build no longer stops on React Native's layout assertion for a hidden view. In `@ng-native/testing`, a `display: none` element is not found by any query, `includeHiddenElements` or not, and a view with no opacity that takes no touch counts as hidden.
