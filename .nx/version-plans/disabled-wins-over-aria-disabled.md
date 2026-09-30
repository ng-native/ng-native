---
__default__: patch
---

When `disabled` and `aria-disabled` disagree, what VoiceOver and TalkBack announce now follows `disabled`, as in React Native.

This applies to `<pressable>`, `<touchable-opacity>`, `<switch>`, `<text-input>`, `<text>` and a `PressBehavior` host. `[disabled]="true" [aria-disabled]="false"` now commits `accessibilityState: { disabled: true }` and is announced as disabled, and `[disabled]="false" [aria-disabled]="true"` commits `{ disabled: false }` and is announced as enabled. Until now `aria-disabled` won both times. `disabled` also wins over `accessibilityState.disabled` in the same way. `aria-disabled` alone still sets the state, as before. `getByRole` reads the same commit, so a test that checked `accessibilityState` on a control carrying both inputs sees the new value. On the web host the element's `aria-disabled` follows the same rule. A stylesheet's `[aria-disabled="true"]` and Tailwind's `aria-disabled:` still match the `aria-disabled` input as written.

`disabled` on `<pressable>`, `<touchable-opacity>`, `<text>` and `PressBehavior` now reads `undefined` rather than `false` when it is not set, so code that reads `disabled()` directly gets `boolean | undefined`.
