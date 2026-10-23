---
__default__: patch
---

An app `mount()` started is destroyed when Fabric stops the surface it is on, so an Android activity recreated after a font size or display size change no longer leaves the old app running beside the new one, with its timers, subscriptions and effects.

Fabric stops a surface through the global `RN$stopSurface`, which React's renderer installs. `mount()` wraps it, around whatever is there and again when something replaced it, so React's handler and anything else that wraps the global are still called. An error the app's destroy throws goes to its `ErrorHandler`.
