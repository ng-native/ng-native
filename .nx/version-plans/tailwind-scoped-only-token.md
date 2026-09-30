---
__default__: patch
---

A custom property declared only under a class, a platform class or a media query, such as `--brand` only under `.dark`, now applies only where that selector matches, instead of `flattenTailwind` substituting its one value everywhere and painting the dark value in light mode too.

`flattenTailwind` substitutes a custom property at build time only when it is declared on `:root`, `:host`, `html` or `*` outside any at-rule, or through an `@property` initial value, and has one value. Any other `var()` of it is left for the engine to resolve per node, fallback included, so `var(--brand, red)` is `red` without the `.dark` class. The same applies to a Tailwind arbitrary property such as `[--my-var:red]`, which now reaches only the elements wearing that class. Tailwind's own `--tw-*` properties are unchanged.
