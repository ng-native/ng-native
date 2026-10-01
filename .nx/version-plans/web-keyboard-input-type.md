---
__default__: patch
---

On the web, a single-line `<text-input>` with `keyboardType` `phone-pad` or `url` is now a `type="tel"` or `type="url"` field, so browsers autofill it as one, and toggling `multiline` on a focused field keeps its caret and selection.

An `email-address` or number keyboard still sets only `inputmode`: `type="email"` trims the value and, like `type="number"`, has no selection API, so `setSelection()` and `[selection]` would throw. `secureTextEntry` keeps the field a `type="password"` field whatever the keyboard.
