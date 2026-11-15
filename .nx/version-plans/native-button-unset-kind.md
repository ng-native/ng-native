---
__default__: patch
---

`<native-button>` with no `kind` no longer commits `kind: 'default'`, so on macOS it is a plain push button rather than the window's default button: it is not drawn in the accent colour and Return does not press it. Only `kind="default"` takes Return.
