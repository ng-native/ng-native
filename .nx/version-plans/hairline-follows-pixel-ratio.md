---
__default__: patch
---

`watchConditions()` from `@ng-native/device` updates the `--hairline` token when a window resize reports a new pixel ratio, such as a Mac window moved to a display of another density, so `border-hairline` and `var(--hairline)` stay one physical pixel thick. React Native's `StyleSheet.hairlineWidth` keeps the value it had at startup.
