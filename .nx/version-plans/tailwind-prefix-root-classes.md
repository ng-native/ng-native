---
__default__: patch
---

`ios:`, `android:`, `web:`, `native:`, `dark:` and the platform `font-mono` match under a Tailwind 3
`prefix`. Tailwind 3 prefixes every class in a variant's selector, so they matched `.tw-platform-ios`
and `.tw-dark`, which nothing sets. `preset.cjs` records the prefix and `flattenTailwind` takes it back
off those classes, so they match the `platform-*` and `dark` classes `mount` and `watchConditions`
put on the root. The dark class stays `dark` with a prefix.
