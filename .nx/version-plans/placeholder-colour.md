---
__default__: patch
---

A `::placeholder` rule now sets a text input's placeholder colour, so `placeholder:text-gray-400` and `.field::placeholder { color: ... }` work, a token in the colour included.

Before, every pseudo-element was refused, and a placeholder could only be coloured through `[placeholderTextColor]`. The rule matches a `<text-input>` only, as a browser's matches an input, and anything in it but the colour is dropped with a warning. Every other pseudo-element is still refused.
