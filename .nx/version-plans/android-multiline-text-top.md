---
__default__: patch
---

A multiline `<text-input>` on Android starts its text at the top, as on iOS and in a `<textarea>`, rather than in the vertical middle.

A multiline field on Android now commits `textAlignVertical: 'top'` when neither the `textAlignVertical` input nor a CSS `vertical-align` sets one. A single-line field is unchanged, and iOS is unchanged.
