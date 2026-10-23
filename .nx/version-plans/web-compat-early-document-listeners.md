---
__default__: patch
---

With `withWebCompat` in the Metro config, a library that adds a listener to `document` as its module loads, before any app is up, no longer throws, and each app with `provideWebCompat()` hears what the library listened for.
