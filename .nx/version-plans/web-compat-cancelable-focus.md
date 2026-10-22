---
__default__: patch
---

Under `provideWebCompat()`, a `focus` and a `blur` event say `cancelable: true`, so a library that calls `preventDefault()` on its input's blur and checks the event is cancelable first (a combobox closing its list) sees it stopped. A browser sends both as not cancelable.
