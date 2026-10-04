---
__default__: patch
---

A rule in a cascade layer keeps the layer's place in the Tailwind sheet: a component class in `@layer components`, written after the utilities, no longer beats a utility beside it, so `rounded-full` on an element with a `.card` that applies `rounded-md` wins, as it does in a browser.
