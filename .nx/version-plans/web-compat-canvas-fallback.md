---
__default__: patch
---

With `@ng-native/web-compat`, what a template or a script writes inside a `<canvas>` is fallback content that stays in the document and is never drawn, whatever its styles say and its text included, as in a browser. Taken out of the canvas, it is drawn where it is put.

`registerHoist` in `@ng-native/fabric` answers a function that takes the registration away again.
