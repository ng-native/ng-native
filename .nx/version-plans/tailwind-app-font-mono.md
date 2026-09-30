---
__default__: patch
---

`font-mono` uses an app's own monospace font on every platform. On Tailwind 4, an
`@theme { --font-mono: ... }` after `native.css` used to lose on device to the preset's Menlo and
`monospace` rules; those now set a custom property on the root that the app's `--font-mono`
replaces. On Tailwind 3, `preset.cjs` no longer sets `theme.extend.fontFamily.mono`, which
overrode a `mono` from the config or an earlier preset, and adds its `Courier New`, Menlo and
`monospace` utilities only while `fontFamily.mono` is Tailwind's own `ui-monospace` stack.
