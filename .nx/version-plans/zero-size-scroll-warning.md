---
__default__: patch
---

In development, a `<scroll-view>` or `<virtual-list>` with content that is still at zero size a second after it lays out now logs a warning naming it, which is the usual sign of a component host without `flex: 1`.

The warning says to give the host, or the element, `flex: 1` or a height, and links the Layout and views page. It comes once per element. A layout with a size within the second, or destroying the element, cancels it, so a collapsed or animating container isn't reported. A horizontal one is measured by its width. In development a `<scroll-view>` now listens to its own layout to do this. A release build doesn't check, and a `<scroll-view>` there commits no layout listener.
