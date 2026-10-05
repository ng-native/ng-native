---
'__default__': patch
---

A `color-mix()` whose share is a token, `color-mix(in srgb, var(--ink) calc(var(--share) * 100%), transparent)`, mixes by the token's value where the rule applies, on its own and as the fallback of another token. It was dropped with a warning, so the colour was never set.
