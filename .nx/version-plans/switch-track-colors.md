---
__default__: patch
---

Binding `[trackColor]` on `<switch>` no longer throws `ColorValue: the value must be a number or Object.` on Android: `trackColorForTrue` and `trackColorForFalse` are colours whose names end in the state they paint, so they were reaching native as raw strings where Android's `ColorPropConverter` takes only a number or a platform-colour map.
