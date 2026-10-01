---
__default__: patch
---

On the web, `mount` now keeps a `dark` class on its root while `ColorScheme` is dark, so `dark:` utilities and a theme's `.dark` block apply in a browser as they do under `watchConditions` on a device, and `ColorScheme.set()` now chooses the scheme there too.

The class follows `prefers-color-scheme`, or the scheme `inject(ColorScheme).set()` chose over it, and `set(null)` hands it back to the system. An app that puts `dark` on a view of its own, for a theme switch of its own, passes `darkClass: false` to `mount`, or its views now also match `dark:` whenever the system is dark.
