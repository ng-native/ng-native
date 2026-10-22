---
__default__: patch
---

A back through history to the older of two entries one screen holds, such as `historyGo(-4)` to a screen's own entry after a query change in place gave it a second one, now returns to that screen rather than to a newer screen at the same url.

The native stack remembers every history entry a screen has been shown in, not only the last, including across a back to the screen and a query change on it. Native pops, `popTo()` and Back went to the newer entry already and are unchanged.
