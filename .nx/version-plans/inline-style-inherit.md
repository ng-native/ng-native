---
__default__: patch
---

`inherit` set in an element's own style, `style="width: inherit"` or `[style.width]="'inherit'"`, is now the parent's value, for the properties a stylesheet takes `inherit` for, where native used to get the word itself.

These are the sizes, `color`, `background-color`, `opacity`, the font and text properties a stylesheet inherits, the corner radii, and a border's widths, colours and styles. Any other property set to `inherit`, `initial`, `unset` or `revert` is dropped with a warning in development, as a stylesheet drops it. `font-family` keeps the word as it did, and the `border` shorthand set to `inherit` is still dropped.
