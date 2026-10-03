---
__default__: patch
---

A Tailwind rule that applies a comma-separated arbitrary value and a pseudo-element variant together, such as `@apply transition-[color,box-shadow] file:font-medium`, now builds, where it failed the whole build with `SyntaxError: Unexpected token CurlyBracketBlock`.

The pseudo-element part is refused with the usual warning and the rest of the rule is kept.
