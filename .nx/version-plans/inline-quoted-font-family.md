---
__default__: patch
---

A `font-family` in a style set on an element, such as `style="font-family: 'Inter-Bold'"`, `[style.font-family]` or a custom property bound on the element and read with `var()`, now commits the first family of the stack without its quotes, as a stylesheet rule does, so the text draws in that face rather than the system font.

A family that needs quotes, such as `'Inter Display'`, can now be named in an inline style, and a stack such as `'Inter Display', sans-serif` commits `Inter Display` where it committed the whole text.
