---
'__default__': patch
---

`Keyboard.dismiss()` from `@ng-native/device` puts the keyboard away. It called React Native's `Keyboard.dismiss()` alone, which blurs only a field React Native's own `TextInput` component recorded as focused, and a `text-input` is the native component with no such record, so the call did nothing on iOS or Android. It now sends `blur` to the focused `text-input`, as a scroll view does at a tap outside the field. A view or a pressable that has the focus, from a hardware keyboard or a D-pad, is left alone: a scroll view no longer sends it `blur`, or takes a tap away from its children to dismiss a keyboard that such a focus does not hold.
