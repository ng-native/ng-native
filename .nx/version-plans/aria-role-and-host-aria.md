---
__default__: patch
---

`role` takes the ARIA roles (`row`, `cell`, `listitem`, `heading`, `dialog` and the rest) and commits one `accessibilityRole` has no word for as native's own `role` prop, and `role` and the `aria-*` attributes are read on any element that draws a view, the host of an app's own component included.

`<view role="row">` type-checks, where it failed with `TS2322`, and no longer sends `accessibilityRole: "row"`, a value native does not know. `Role` is exported from `@ng-native/components`. `getByRole` and its siblings match `role` as well as `accessibilityRole`. On a component's host, `aria-label` was dropped and is now the label; the state and value attributes become `accessibilityState` and `accessibilityValue`, and `aria-hidden`, `aria-live`, `aria-modal` and `aria-labelledby` the props React Native maps them to.
