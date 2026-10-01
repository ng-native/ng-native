---
__default__: patch
---

On the web, a single-line `<text-input>` is now an `<input>`, so its text sits centred in a taller field as on iOS and Android, and with `secureTextEntry` it is a `type="password"` field that browsers and password managers treat as one.

A multiline `<text-input>` is still a `<textarea>`: the element is swapped when `multiline` is set, carrying its attributes, value, focus and listeners. A selector or a test that looked for the field as a `textarea` now finds an `input` unless the field is multiline. A multiline field with `secureTextEntry` still masks with `-webkit-text-security`.
