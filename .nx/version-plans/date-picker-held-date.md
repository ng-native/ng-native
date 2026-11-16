---
__default__: patch
---

On Android, `<ui-date-picker>` in `@ng-native/expo` no longer marks its Signal Forms field touched, or writes its value again, when Compose first draws the picker.

A report of the date the picker already holds is not taken as a pick on either platform: it emits no `touch` and leaves the `value` model as it is.
