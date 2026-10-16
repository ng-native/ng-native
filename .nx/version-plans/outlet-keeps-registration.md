---
__default__: patch
---

A `<native-stack-outlet>` or `<native-tabs-outlet>` that goes takes its route's context away only while the context is still its own, as Angular's `RouterOutlet` does. A sheet presented over the tab bar, with a stack of its own and swiped away, cleared the tab bar's place in the page under it as that page came back, so the next tab chosen opened inside the first tab's stack, or left the screen blank, while the bar showed the new tab selected.
