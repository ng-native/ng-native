---
__default__: patch
---

`injectService()` calls in one test share an app, so a service and a service it injects are the same instances a later call returns, where each call made an app of its own and the two never saw each other.

A call with `providers` starts a new app, which the calls after it use. The app ends with its test, whether or not `cleanup()` ran. A test that relied on two bare calls returning separate instances now gets one: pass `providers: []` to the second call for an app of its own.
