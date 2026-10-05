---
'__default__': patch
---

A `var()` whose fallback is a `calc()` of a viewport or font unit and a length, `max-width: var(--max, calc(100vw - 32px))`, takes that fallback where nothing sets the token. The fallback was lost with no warning, so the declaration set nothing and still hid what an earlier rule had set.
