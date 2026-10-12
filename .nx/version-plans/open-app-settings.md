---
'__default__': patch
---

`DeepLinks` has an `openSettings()`, which opens the app's own page in the system settings: where to send a person once a permission's `blocked()` is true.

Android has no url for that page, so `open()` could not reach it. `DeepLinkSource` gains an optional `openSettings`; a source without one, as a test's stand-in written before now, opens nothing.
