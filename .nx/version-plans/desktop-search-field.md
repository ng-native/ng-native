---
__default__: patch
---

On macOS `<search-field>` is drawn as AppKit's `NSSearchField` at its `controlSize`, with its text, placeholder, type, `autoCapitalize` and `tintColor`. Return sends `(search)`, the clear button and Escape empty it and send `(cancel)`, and `focus()` and `blur()` work.
