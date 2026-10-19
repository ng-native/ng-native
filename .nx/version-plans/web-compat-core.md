---
__default__: patch
---

`@ng-native/web-compat` is a new, experimental, opt-in package for rendering a component library written for the browser, and this first release is partial.

`provideWebCompat()` gives the engine's nodes the core DOM members such a library calls (`nodeName`, attributes, `classList`, the nodes around one, `appendChild`, `insertBefore`, `removeChild`, `textContent`, `addEventListener` and `dispatchEvent`), provides a `document` that creates engine nodes and whose `body` draws over the screen for overlays, defines the basic `window` globals, and delivers a `click` listener from a press. `withWebCompat()` from `@ng-native/web-compat/metro` names the libraries and directories written for a browser to the build. Nothing changes in an app that does not add the provider, and everything it adds is taken away when the app is destroyed. Selectors, `element.style`, geometry, observers, forms and the rest of the DOM come in later releases.
