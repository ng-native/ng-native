---
__default__: patch
---

`NativeNavigation.present()` now shows a page of a tab that is not in front over the tab that is, where it selected the page's own tab and added the page to that tab's stack, as its only screen when the tab had not been opened.

The page is shown on the app's root stack, over the tab bar, through a root outlet named `presented`: while it is up `router.url` reads `/home(presented:invoices/7)`, and a back or the dismissing swipe returns to `/home`. Its route keeps its params, resolvers, data and the guards and providers of the routes it sits inside. A `push()` from the page leaves it for the pushed url's own place. A page of the tab in front, or of no tab, is presented where its url puts it, as before, and so is every page in an app whose root is not a `<native-stack-outlet>`.
