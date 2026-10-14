---
'__default__': minor
---

A `line-height` with no unit written in a `style`, `style="line-height: 1.5"`, `[style.line-height]="'1.5'"` or `[style.line-height]="1.5"`, is now a multiple of the font size, as it is in a stylesheet, where it was 1.5 points. Text inside it multiplies its own font size by the number, as in a stylesheet. A style that meant points this way, `style="line-height: 20"` or `[style.line-height]="20"`, needs its unit: `line-height: 20px`. A number in a style object, `{ lineHeight: 24 }`, is still points. A negative `line-height` in a style is dropped with a warning, as a browser drops it.

A `padding`, `margin`, `inset` or `gap` with a value for each side, `style="padding: 4px 8px"`, sets each side, where native dropped the text and the element had none. One with more values than it takes, `padding: 1px 2px 3px 4px 5px`, is dropped with a warning. `!important` in a `style` attribute is read as it is in a bound style, where the value was dropped.
