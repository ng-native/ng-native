---
__default__: patch
---

`@ng-native/eslint-plugin` has a new `prefer-hairline-token` rule, a warning in `recommended`, that reports `StyleSheet.hairlineWidth`, which React Native works out once at startup, and suggests `var(--hairline)`, which `watchConditions()` updates when a window reports a new pixel ratio.
