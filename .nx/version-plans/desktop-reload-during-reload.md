---
__default__: patch
---

On macOS and Linux, a desktop app running from the dev server no longer crashes when a reload reaches it while it is already reloading, such as the dev server's reload command sent twice in quick succession.

React Native's own reload ran for a host the runtime was still making or already tearing down, on a thread of its own that outlived the host, and crashed the app. Those reloads are now dropped: the reload already under way loads the latest bundle.
