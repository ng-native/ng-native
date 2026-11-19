---
__default__: patch
---

On Linux, a dev run with `NGN_LOG_COMMITS=1` also logs each window's frames as `[ngn] frame N ms`, the time from the start of the GTK frame clock's update to the end of its paint, beside each commit's time.
