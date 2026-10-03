---
__default__: patch
---

A variable font declared with a weight range, `font-weight: 100 900`, keeps the range and the text keeps its `font-weight`, where the range was read as its lowest weight, the face registered as `Inter-100`, and the weight taken off the text so everything drew at the lightest.

The face is registered under the family and both ends of the range, `Inter-100to900`. Two files that split a family by range are matched by the range each covers.
