---
__default__: patch
---

`DeepLinks` delivers the launch url to each `subscribe()` separately. A listener that throws is
reported to Angular's `ErrorHandler` and no longer keeps the launch url from the listeners after
it, such as the router's. The same function subscribed twice keeps getting the launch url until
both subscriptions stop, not just one.
