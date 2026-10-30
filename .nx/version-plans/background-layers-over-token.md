---
__default__: patch
---

A `background` shorthand of gradients over a token's colour, `background: linear-gradient(180deg, #ffffff33 0%, #ffffff00 67.7%), var(--primary)`, compiles to the gradients as its image and the token as its `background-color`, where Metro dropped the whole declaration with "'background' mixes var() with other values". The token has to be the whole of the last layer, with no token in the other layers. A last layer that is a gradient with a token in it goes through the existing gradient path as before, and a token anywhere else is still dropped with that warning.
