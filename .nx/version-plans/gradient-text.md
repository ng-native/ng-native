---
__default__: patch
---

`<gradient-text>` in `@ng-native/components` draws a gradient, or any background, through its letters: text that wraps and scales like any other, filled by the `background-image` its class gives it. A rule with `background-clip: text` now applies to `<gradient-text>` alone, so on a `<text>` it no longer leaves transparent letters on a block of color, and the build no longer reports the declaration as not mapped. It needs `@react-native-masked-view/masked-view`, which Expo Go includes.
