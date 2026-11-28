---
__default__: patch
---

`@ng-native/web-compat` now gives `Intl.NumberFormat` a `formatToParts` where the runtime has none, as Hermes on iOS has none: Taiga UI's number input with a locale's digit groups failed on a device with `undefined is not a function`. It names each part as a browser does, for numbers.

HTML's elements the engine has no view of, `<aside>`, `<output>`, `<pre>` and the rest, no longer log "is not a known element" in development in an app with the package.

`Intl.NumberFormat`'s own `formatToParts` on Android, which takes no `BigInt`, is given one as the number it is.
