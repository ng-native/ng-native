---
__default__: patch
---

`present()` from `@ng-native/router` takes an `anchor`, an element or a component, and commits its view's tag as the presented screen's `anchor` prop, which the macOS host shows the screen as a popover at. iOS, iPadOS included, and Android ignore it.
