---
__default__: patch
---

`fileRoutes` gives a lazy page's `canMatch` guards the same instances of its `routeMeta` providers that the page and its resolvers get, as Angular does for an eager page.

Before, a lazy page's `canMatch` guards ran in an injector of their own, made for each navigation and destroyed after it, so a service a guard wrote was not the one the page read. The injector is now made once for the page's route, and the page's routes are loaded into it. With `withAutoCleanupInjectors()`, it is destroyed when the page is left and made again on the next visit, as an eager page's is.
