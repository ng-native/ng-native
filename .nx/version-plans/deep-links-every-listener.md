---
__default__: patch
---

`DeepLinks` delivers the url an app was launched with to every `subscribe()` listener rather than
only the last one to subscribe, and one listener stopping no longer stops it reaching the others.
An app that subscribed alongside the router took the launch link from it, and one that subscribed
and stopped before the url was known left the router never following it.
