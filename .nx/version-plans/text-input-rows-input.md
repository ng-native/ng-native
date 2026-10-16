---
__default__: patch
---

`<text-input>` takes `rows` as an input, so a multiline field sized by `rows` no longer logs "has no prop 'rows'" in development, and `rows` is no longer sent to the native field on iOS or Android.

`rows` can be bound as well as written as an attribute: `[rows]="lines()"`. The engine reads it for the field's height as before, and neither platform's native field has a prop of that name.
