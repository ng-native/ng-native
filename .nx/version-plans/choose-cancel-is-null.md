---
'__default__': patch
---

On iOS, `Dialogs.choose()` resolves `null` when the choice with `style: 'cancel'` is picked or the sheet is dismissed, as it does on Android. It resolved that choice's index, so a caller checking for `null` took a dismissal for a choice.
