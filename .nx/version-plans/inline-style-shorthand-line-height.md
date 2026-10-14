---
'__default__': minor
---

A `line-height` with no unit written in a `style`, `style="line-height: 1.5"` or `[style.line-height]="'1.5'"`, is now a multiple of the font size, as it is in a stylesheet, where it was 1.5 points. A style that meant points this way, `style="line-height: 20"`, needs its unit: `line-height: 20px`. A number in a style object, `{ lineHeight: 24 }`, is still points.

A `padding`, `margin`, `inset` or `gap` with a value for each side, `style="padding: 4px 8px"`, sets each side, where native dropped the text and the element had none.
