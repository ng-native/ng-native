---
__default__: patch
---

`preventNativeDismiss` on a page inside a presented screen that is a stack of its own now guards the sheet: the stack gives the refusal of its top screen to the presented screen, and `(nativeDismissCancelled)` reaches the page, for a swipe down on iOS and for Android's Back.

Before, the binding landed on the first screen of the inner stack, and the sheet swiped away with no warning.
