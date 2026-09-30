---
__default__: patch
---

Tailwind's theme tokens are now resolved on device, as on the web: an element that sets `--color-brand` or `--spacing`, from a component stylesheet, a `style` attribute, a `[style.--x]` binding or code, restyles every utility inside it that reads that token, in Tailwind 3 and 4. Tokens of bare colour channels (`--primary: 0 100% 50%` read through `hsl(var(--primary))`), colour tokens defined with `color-mix()`, tokens defined as `calc()` of another (percentages included, as Open Props writes its shadows), and transition, animation and filter values taken from a token now compile. Tailwind 3's `bg-opacity-*` classes fade a colour whose channels are a token, arithmetic around a token in `em` keeps its sign, `max()` and `min()` take two tokens, and the type scale's line heights land on whole points. Nodes that match the same rules under the same parent now share one resolved style, which roughly halves the time to style a long list of cards.
