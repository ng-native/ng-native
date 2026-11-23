---
__default__: minor
---

Queries leave out the screens of a native stack that a pushed screen covers, as React Native Testing Library leaves out what is hidden from accessibility, so a test that found content on a screen below the top no longer finds it.

To migrate, query what is on the screen in front, or pass `{ includeHiddenElements: true }` to a query that means to reach a screen below it.

A screen under a push, a `fullScreenModal` or a `containedModal` is hidden, and on Android a screen under a `modal` (what `present()` shows by default) or a `pageSheet` too, which Android shows full screen. Everything on a hidden screen is hidden, `within` included, whether it starts from the screen or from a view on it, and so is what is `within` a view under one hidden from accessibility. A screen under a sheet or a transparent modal is still showing, and still found, and so is one under a `modal` or a `pageSheet` on iOS.
