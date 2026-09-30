---
__default__: patch
---

A themed custom property read with a fallback, such as `var(--brand, red)` where `--brand` is
declared under both `:root` and `.dark`, resolves per node on device, like one read without a
fallback. `flattenTailwind` used to replace it with the fallback, so neither theme's value applied.
