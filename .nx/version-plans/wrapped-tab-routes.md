---
__default__: patch
---

A tab whose route has no component of its own, a `loadChildren` wrapper or a group of routes as Analog's file routes make, now opens, where `<native-tabs-outlet>` threw `no <native-tab> has path=""`, and switching away from it and back keeps it as it was, its own stack included.

A tab at `path=""` now works beside routes outside the bar: `present()` of one of its pages from another tab shows the page over that tab, a push into it uses the stack it already has, and returning to it returns where it was left. A push into any tab that has been opened no longer builds a second stack in the tab's screen.

A sheet or modal presented in a tab's own stack is now dismissed when another tab comes in front, where it stayed on screen over that tab, and returning to its tab returns to the page beneath it.
