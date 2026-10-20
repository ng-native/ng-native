---
__default__: patch
---

A web library's HTML elements start with a browser's default box sizing and display in an app that uses `@ng-native/web-compat`.

A library's HTML elements are now sized `content-box` and its blocks are blocks, as in a browser: padding and border add to an element's width and height, and a `div`, a `p`, a `section`, a list and the other block elements lay out as `display: block`, while a `button`, a `select` and a `table` stay `border-box`. This changes layout for apps using web-compat; an author style or a stylesheet still wins over each default, and an app that does not call `provideWebCompat()` lays out as before.
