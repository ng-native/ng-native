---
__default__: patch
---

`userEvent.type` in `@ng-native/testing` types each character at the field's caret, replacing a selection, rather than always at the end of the text.

A field that moves the caret or the selection with `setSelection()` while handling a keystroke now has the next character typed there, where `userEvent.type` used to append it. A test that typed into such a field and expected the appended text needs the text a text field gives: for a caret set to 0 after each key, typing `ab` ends with `ba`. A field that never moves the caret, or that refuses or rewrites a key, behaves as before.

When the app puts different text back without a selection, the caret keeps its distance from the end of the old text, as an iOS field does. A key that does not fit in what `maxLength` leaves, such as an emoji for one free unit, is dropped whole.
