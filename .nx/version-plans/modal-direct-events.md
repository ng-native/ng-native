---
__default__: patch
---

A `<modal>`'s `(requestClose)`, `(show)`, `(dismiss)` and `(orientationChange)` reach that modal's own handler only, as React Native delivers them. A modal presented from inside another one handed them on to the one around it as well, so one Escape on macOS, or one back press on Android, closed both.
