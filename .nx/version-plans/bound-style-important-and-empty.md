---
__default__: patch
---

A bound style ending in `!important`, `[style.width]="'10px !important'"`, is now read as its value. Before, Angular left a space where it took `!important` off, and the value reached native as the text `'10px '`, which it dropped. A bound style set to an empty string, `[style.width]="''"`, now takes the declaration out, as a browser does, so a class rule for it applies again. Before, the empty value stayed in the inline style. A bound style that is only whitespace is dropped with a warning, and the value it had is kept, as Chrome does.
