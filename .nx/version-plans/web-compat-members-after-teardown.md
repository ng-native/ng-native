---
__default__: patch
---

Under `provideWebCompat()`, an element of an app that has been destroyed still answers as an element (`getAttribute`, `classList.add`, `style` and the rest), as an element out of the document does in a browser, so a library's timer that fires after its app is gone no longer throws. An element of an app that never asked for the package still has none of it.
