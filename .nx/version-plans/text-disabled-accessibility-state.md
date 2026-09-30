---
__default__: patch
---

A disabled `<text>` is now announced as disabled by VoiceOver and TalkBack, as React Native's `Text` is.

`<text>` consumed `disabled` to stop presses and publish `data-disabled`, but never put it into the accessibility state, so a disabled `<text pressable>` was announced as an active control. It now commits `accessibilityState: { disabled: true }`, merged with any `accessibilityState` the app sets, and clears it when the text is enabled again. As in React Native this applies to every disabled text, pressable or not, nested or not. On the web host the text gets `aria-disabled="true"`. An `aria-disabled` input still takes precedence over `disabled`, as it does on the other controls.
