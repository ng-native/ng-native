---
__default__: patch
---

`<native-stack-outlet>` and `<native-tabs-outlet>` now bind route data to a page's inputs by the options given to `withComponentInputBinding()`, as `RouterOutlet` does. With `queryParams: false` a query param no longer reaches an input of the same name, and with `unmatchedInputBehavior: 'undefinedIfStale'` an input keeps its default until its key has been in the route. Before, both options were ignored.
