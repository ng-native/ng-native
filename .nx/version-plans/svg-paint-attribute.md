---
'__default__': patch
---

A shape with no paint of its own takes the `fill` or `stroke` its `<svg>` sets as an attribute, so `<svg fill="currentColor">` icons such as Material's date picker toggle draw in the text colour around them instead of black.
