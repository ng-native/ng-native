---
__default__: patch
---

A disabled `<pressable>`, `<touchable-opacity>`, `<switch>` or `PressBehavior` host now publishes `data-disabled`, so `[data-disabled]` rules and Tailwind's `disabled:`, `group-disabled:` and `peer-disabled:` variants apply to it, and stop applying when it is enabled again.

`:disabled` still does not match these controls: their `disabled` is an input, not a prop left on the node, so style them with `[data-disabled]` or `disabled:`.

`fabric.render({ props: true })` in `@ng-native/testing` now prints nested props in full, with keys sorted at every depth. It printed a nested object such as `accessibilityState` as `{}` (keeping only nested keys that happened to share a name with a top-level prop), so a disabled control looked as if it announced nothing while `getByRole(...).props`, which reads the same commit, showed `disabled: true`. What native receives has not changed. A snapshot or golden string of this output that contains a nested prop needs updating.
