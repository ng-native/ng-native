---
__default__: patch
---

`(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)` and `(mouseout)` on an element listen for React Native's pointer events, where they were never delivered on any host, and a finger's pointer events do not run them. `(dblclick)`, `(contextmenu)` and `(wheel)` listen for the macOS host's events of their own. A build warns of a binding to a DOM event no device sends, such as `(click)` on a `<view>`, naming what to bind instead, from the same table as `@ng-native/eslint-plugin`'s `no-dom-events`. That rule reads `expo.platforms` from the nearest `app.json`: with no desktop OS listed it reports the eight events above as never firing, and with `macos` listed the new `desktop-only-events` rule, a warning in `recommended`, says each fires only on macOS. `@ng-native/eslint-plugin` now depends on `@ng-native/metro`.
