---
__default__: patch
---

`PressBehavior` has `disableWhile(signal)`, for a component that composes it to refuse presses from its own state, a button that is loading: either that or the `disabled` input disables the control, for the press, for `[data-disabled]` in a stylesheet and for what is announced.

`[data-disabled]` now follows whether presses are refused, so on a `<touchable-opacity>` it is also set by `aria-disabled` and `accessibilityState.disabled`, which already refused its presses.
