---
__default__: patch
---

`injectToken('--accent')` from `@ng-native/device` reads a CSS custom property's resolved value as a signal, at the root or at a given node; on iOS and Android it follows the colour scheme, media conditions and stylesheet changes, and on the web it follows class and inline style changes under the mount point, the `dark` class `mount` keeps included. `Engine.token` and `Engine.watchToken` do the same without Angular. A shape's `fill` or `stroke` written as `var()` on the shape itself is resolved against the tokens in scope.
