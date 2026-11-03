---
__default__: patch
---

On iOS, a `position: fixed` box as wide as its content wraps its text in its page, as in a browser and on Android, where it wrapped in a narrower box it was written in, and on both platforms a fixed box committed under its page keeps its static position on an axis it has no inset on.

Such a box, one with no width of its own (`width: auto` counts as none) and not stretched between a `left` and a `right`, is now committed under its page on iOS, as a fixed box inside a scroll view already was. There it draws over the page's other content and an ancestor's `opacity` or `transform` no longer reaches it. On iOS a fixed box goes back under its parent once nothing holds it under its page: it has a width of its own or is stretched between a `left` and a `right`, and nothing between it and its page scrolls or clips, whether the box itself or a box it is in changed. A fixed or absolute box is also taken out from under its parent when a box it is in starts to clip by an `overflow` set on that box as a value, and an absolute one goes back as that box stops, where before only a class or a rule doing so moved it.

On an axis with no inset, a fixed box under its page was placed at the page's start. It is now placed where a browser has it, as the only child of the box it is written in: inside that box's padding and border in points, aligned as that box aligns its children, and from the right in a box laid out right to left. Inside a scroll view it still starts at the page's start on that axis, on both platforms. An absolute box committed under the box it is placed against, past a parent that clips, is placed at its static position the same way.
