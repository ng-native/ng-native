---
__default__: patch
---

`NativeNavigation.reset()` to a url that lands on the screen already on top, such as the same page with another query, a route config that redirects to it, or a guard that redirects there with a query, takes the screens under it off the stack. It left them, so Back still went to the old stack.
