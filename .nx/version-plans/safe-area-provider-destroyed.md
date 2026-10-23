---
'__default__': patch
---

`SafeArea` from `@ng-native/device` forgets what a `<safe-area-provider>` from `@ng-native/components` reported once that provider is destroyed. It kept the provider's frame and insets, so `Screen.window` stayed at the frame the provider last measured: after a rotation it still reported the old width and height, and `orientation` and `compact` with it. Now `frame` goes back to null, `insets` to zero and `known()` to `false`, the `--safe-area-inset-*` custom properties go back to zero, and `Screen.window` follows `Dimensions` again until another provider reports. A provider destroyed after another one has reported leaves that report alone, and one destroyed while an older provider is still up puts back what that one last reported.
