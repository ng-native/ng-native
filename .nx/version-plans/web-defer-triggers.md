---
__default__: patch
---

`@defer (on interaction)`, `(on hover)` and `(on viewport)` load their content on the web host, rather than keeping the placeholder forever and reporting an error to the `ErrorHandler` for each trigger.

Angular registers these triggers on the element itself: it asserts in a development build that the element is an `Element`, listens with `addEventListener`, and watches it with the page's `IntersectionObserver`. An element node from `@ng-native/web` now passes `instanceof Element`, forwards `addEventListener` and `removeEventListener` to the DOM element it wraps, and can be observed by an `IntersectionObserver`, whose entries name the node it was given.
