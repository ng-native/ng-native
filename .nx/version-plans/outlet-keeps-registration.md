---
__default__: patch
---

When a `<native-stack-outlet>` or `<native-tabs-outlet>` is destroyed, it clears its route's context only while that context is still its own, as Angular's `RouterOutlet` does. A sheet presented over the tab bar, with a stack of its own and swiped away, cleared the tab bar's place in the page under it as that page came back, so the next tab chosen opened inside the first tab's stack, or left the screen blank, while the bar showed the new tab selected.
