---
'__default__': patch
---

On iOS a single-line text field in a row with `align-items: baseline` now sits on the same baseline as the text beside it.

The field's text is centred in its line by leaving `lineHeight` out, which left the field saying its baseline was the font's own: higher than a paragraph's in a line as tall, so the row lifted the text beside the field by the difference, about 2.5 points for 16-point text in a 24-point line. Half the room the line has over the font is now kept as padding over and under the field's text. The field is as tall as before; its `paddingTop` and `paddingBottom` are larger by that half where it is in such a row.
