---
__default__: patch
---

The Tailwind 3 docs, the `@ng-native/tailwind` README and `preset.cjs` say how to list the preset
beside an app's own preset: after it, as `{ ...require('@ng-native/tailwind/preset.cjs'), presets: [] }`.
Listed plainly after another preset, Tailwind 3's default theme, which it adds beneath each preset
with no `presets` key, overrides that preset's `spacing`, `fontSize`, `colors` and the rest.
