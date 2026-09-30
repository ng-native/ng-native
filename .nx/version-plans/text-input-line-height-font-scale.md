---
__default__: patch
---

On iOS, a single-line `<text-input>` with a line height grows with the system text size again, and `Conditions` has an optional `fontScale` for it.

The line box a single-line iOS field keeps as its `minHeight` is scaled by the system text size, capped by the field's `maxFontSizeMultiplier` and not scaled when `allowFontScaling` is false, as React Native scales `lineHeight`. `Conditions` in `@ng-native/fabric` gains an optional `fontScale`, which `currentConditions()` and `watchConditions()` in `@ng-native/device` fill in from `PixelRatio.getFontScale()`; without it the scale is 1. `watchConditions()` now hands the engine the new text size before it re-measures text, which is one more commit when only the text size changes. An app that builds `Conditions` itself passes `fontScale` to get the scaling.
