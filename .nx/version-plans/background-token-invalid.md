---
__default__: patch
---

A `background` of gradients over a `var()` now draws neither when the token is unset or is a word that fits no part of a background, as Chrome does, where the gradients stayed and only the colour went.

`background: var(--x)` of such a token takes away an image a weaker rule declared. A gradient set as the token on an element is drawn as one more layer under the written ones, and its colour under them. A length, two lengths, `none`, or words such as `center` or `no-repeat` in the token or its fallback leave the written gradients and no colour, as in a browser.
