---
__default__: minor
---

Queries leave out the screens of a native stack that a pushed screen covers, as React Native Testing Library leaves out what is hidden from accessibility, so a test that found content on a screen below the top no longer finds it.

To migrate, query what is on the screen in front, or pass `{ includeHiddenElements: true }` to a query that means to reach a screen below it.

A screen under a push, a `fullScreenModal` or a `containedModal` is hidden, and so is everything on it, `within` included. A screen under a sheet or a transparent modal is still showing, and still found.
