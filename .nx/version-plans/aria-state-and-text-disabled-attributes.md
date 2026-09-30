---
__default__: patch
---

Tailwind's `aria-disabled:`, `aria-checked:`, `aria-busy:`, `aria-expanded:`, `aria-selected:` and `aria-hidden:` variants, and selectors such as `[aria-disabled="true"]`, now match a component carrying that aria input, and a disabled `<text>` publishes `data-disabled`, so `disabled:` and `[data-disabled]` apply to it.

These aria attributes are inputs that set the accessibility state, and until now the component consumed them and left nothing on the node for a selector to read, so every `aria-*:` utility compiled and never applied. The component now puts each one back on the node as the attribute it came in as (`aria-disabled="false"` does not match `aria-disabled:`). What VoiceOver and TalkBack are told has not changed, and the attributes are never sent to native.

`<text>` takes `disabled` from the same base as `<pressable>` and consumed it the same way, so `:disabled` never matched it and nothing else did either. `:disabled` still does not match a text; use `[data-disabled]` or `disabled:`.
