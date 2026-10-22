---
__default__: patch
---

Under `@ng-native/web-compat`, `focus()` on what is not a text field scrolls it into sight only in answer to a touch, and never with `{ preventScroll: true }`, so a library that focuses a panel as its page is built no longer opens the screen part way down.
