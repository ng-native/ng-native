---
__default__: minor
---

`StatusBar` takes a new `'auto'` style that follows `ColorScheme`, and new apps follow the system's light or dark mode, claim it, and style both schemes.

`'auto'` asks for dark content while the color scheme is light and light content while it is dark, and changes with the scheme, a `ColorScheme.set()` theme switch included. `state` reports `'auto'` rather than the style it resolved to. A claim with a fixed style keeps it. `StatusBarSource.setStyle` now takes the new `PlatformStatusBarStyle` type, which leaves `'auto'` out, so a custom source never receives it.

The template, `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` now write `"userInterfaceStyle": "automatic"` in `app.json` in place of `"dark"`, which locked iOS to dark so that `ColorScheme.set('light')` did nothing. Their root component claims `StatusBar.set({ style: 'auto' })`, so Android no longer shows white status bar icons on a light screen, and its styles have a light palette with the dark one under `@media (prefers-color-scheme: dark)`. Existing apps are unchanged.
