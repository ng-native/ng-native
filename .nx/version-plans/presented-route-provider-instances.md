---
__default__: patch
---

In `@ng-native/router`, a page of another tab shown with `present()` shares one instance of each service the routes above it provide between those routes' guards, the page's guards and resolvers, and the page, as in its tab.

Before, the presented copy put every provider on the page's own route, so a service an ancestor's guard wrote and the page or a resolver read was two instances. A page with providers of its own that had been shown in its tab first also reused the injector Angular made for it there, under the tab's instances rather than the presented ones. The presented page's `ActivatedRoute` now has a parent route for each route it sits inside, each without a component, and reads their data and params through Angular's inheritance.
