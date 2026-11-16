---
__default__: patch
---

`<native-stack-outlet>` and `<native-tabs-outlet>` now bind route resources to a page's inputs under `withComponentInputBinding()` and `withRouterResources()`, as `RouterOutlet` does: a blocking resource arrives as its value and a `nonBlocking()` one as the resource itself. Before, a route resource never reached an input on either outlet.

Both outlets now bind through Angular's own input binder, so an update to a param, query param or data after the page opens reaches its input a microtask after the navigation, as under `RouterOutlet`, rather than during it.
