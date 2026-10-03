---
__default__: patch
---

`NativeNavigation.back()` called while the navigation that shows the page is still in flight, as from an `effect()` in the page's constructor, goes back once that navigation ends, where the call was ignored and the page stayed on screen.
