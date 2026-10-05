---
'__default__': patch
---

A token that falls back to a value with several parts is read for two more properties: `border-radius: var(--r, 50% 50% 50% 0)` gives each corner its own radius, and `transform: var(--t, translateX(-50%) rotate(-45deg))` takes the list. The first gave every corner the token and no fallback, without a warning; the second was dropped with one.
