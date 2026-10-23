---
__default__: patch
---

A web library's `<select>` under `provideWebCompat()` now chooses the way a browser's does in three cases where it did not:

- Pressing the option it already shows closes the list and says no `input` or `change`, where it said both, so a form no longer marks the field as changed when nothing was.
- An option inside a disabled `<optgroup>` cannot be pressed, and is not the one shown first when nothing is chosen.
- Of two options with the same value, or with no value and the same text, the one chosen by `selectedIndex`, by `selected` or by a press is the one the select shows and reports, where the first of them always was. Taking that option out chooses again, as removing the chosen option does, instead of moving to the other one. A `value` set by a script or a binding still chooses the first option of that value.
