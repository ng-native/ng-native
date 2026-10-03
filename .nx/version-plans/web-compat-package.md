---
__default__: patch
---

`@ng-native/web-compat` is a new, experimental, opt-in package for rendering a component library written for the browser. `provideWebCompat()` gives the engine's nodes the DOM members such a library calls (attributes, `classList`, `style`, tree walks, selectors, sizes, `addEventListener`), provides a `document` whose `body` draws over the screen for overlays, defines the `window` globals a library reads, `ResizeObserver` among them, and delivers a `click` listener from a press.
