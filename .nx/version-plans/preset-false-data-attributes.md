---
__default__: patch
---

The Tailwind presets' `disabled:`, `focus:`, `focus-visible:`, `hover:` and `hovered:` variants no longer match a `data-disabled`, `data-focus` or `data-hover` attribute whose value is `"false"`. An attribute binding to a boolean writes that string when it is off, which styled the element as disabled, focused or hovered.
