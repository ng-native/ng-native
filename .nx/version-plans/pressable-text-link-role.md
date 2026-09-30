---
__default__: patch
---

A `<text pressable>` is now announced as a link by VoiceOver and TalkBack, as React Native's `Text` is.

A pressable text commits `accessibilityRole: 'link'` unless it has a `role` or `accessibilityRole` of its own, or a role contributed by a directive on it, or is disabled (by `disabled`, or when that is unset by `aria-disabled`, `accessibilityState.disabled` or a directive's contributed state). A nested pressable text gets it too. The role follows `pressable` and `disabled` as they change. On the web host the element gets `role="link"`.

This changes what screen readers announce and what tests find: `getByRole('link')` now also finds pressable texts, so a query that expected a single link can now find several. `getByText` is unchanged. Set `role` or `accessibilityRole` on the text to keep another role.

A role contributed through `contributeAccessibility` now also ranks above the role a component implies by default, so a directive composed onto a `<switch>` that contributes a role now wins over `switch`.
