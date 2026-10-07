---
'__default__': patch
---

`outline: none`, and any other outline of no width, is no longer sent to the native view, which fixes text vanishing from a focused text field on Android.

On Android a text field given an outline prop after it is first drawn has its background set again, and the padding Android gives a text field comes back over the padding the field was laid out with. A field as tall as its line then clips all of its text. A stylesheet that takes the focus ring off with `:focus { outline: none }` was such an update: the field's text disappeared when it was focused, and stayed gone.
