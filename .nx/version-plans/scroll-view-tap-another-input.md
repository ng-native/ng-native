---
__default__: patch
---

A tap on another `<text-input>` inside a `<scroll-view>`, `<virtual-list>` or `<section-list>` no longer dismisses the keyboard while a field has focus, with `keyboardShouldPersistTaps` at `'never'` or `'handled'`.

The field takes the focus with the keyboard still up, as in React Native; before, it took a second tap. Any other tap does what `keyboardShouldPersistTaps` says, as before.
