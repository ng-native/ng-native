---
__default__: patch
---

A `<switch>` bound to a Signal Forms field marks the field touched when the user flips it, so a form that shows its errors once a field is touched shows them for a switch too, and it publishes `invalid` and `touched` as `data-invalid` and `data-touched` for a stylesheet, as `<text-input>` does. `<section-list>` takes `contentPadding` and `keyboardShouldPersistTaps` and passes them to its list as `<virtual-list>` takes them.
