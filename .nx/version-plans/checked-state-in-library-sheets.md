---
__default__: patch
---

With `@ng-native/web-compat`, a library's stylesheet now matches `:checked` and `:indeterminate` by a checkbox's or a radio's state as it changes: a tap, a script setting `checked` or `indeterminate`, a form binding, another radio of the group being checked, and a form reset.

Before, a library's `:checked` rule matched only the `checked` attribute the control started with, so Taiga UI's checkbox filled in when tapped but never drew its tick.

A library's `:placeholder-shown` now matches a field with a placeholder and no text, following what is typed, a script setting its value, the placeholder coming or going, and a form reset: Taiga UI rests a field's label inside it until something is typed.

`Engine.setControlState` is new: it says a control's state for `:checked`, `:indeterminate` and `:placeholder-shown`, apart from the attribute of the same name, for a package that keeps one.
