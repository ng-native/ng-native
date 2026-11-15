---
__default__: patch
---

On macOS `<text-input>` maps `autoCorrect`, `spellCheck`, `smartInsertDelete`, `autoCapitalize`, `maxLength`, `placeholderTextColor`, the `selection` prop and `autoFocus` onto its AppKit field, switches `secureTextEntry` in place, and sends `(focus)` when it takes the keyboard. A new `smartQuotes` input turns curly quotes and dashes on or off as the user types on macOS, following `autoCorrect` when unset; iOS, Android and the web ignore it.
