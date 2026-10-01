---
__default__: patch
---

On the web, a single-line `<text-input>` with `keyboardType` `phone-pad` is now a `type="tel"` field, so browsers autofill it as one, and toggling `multiline` on a focused field keeps its caret and selection.

The other keyboards still set only `inputmode`: `type="url"` and `type="email"` trim the value an app sets, and `type="email"` and `type="number"` have no selection API, so `setSelection()` and `[selection]` would throw. `secureTextEntry` keeps the field a `type="password"` field whatever the keyboard.
