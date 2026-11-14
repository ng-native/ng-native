---
__default__: patch
---

On macOS a click into a `<search-field>` no longer reports a blur (`searchBlur`, and `touch`, which marks a `[formField]` touched) as it takes the keyboard: the field reports one only once the keyboard has left it.
