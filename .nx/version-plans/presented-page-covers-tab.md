---
'__default__': patch
---

A page of another tab shown with `present()` puts the tab under it behind, so `SCREEN_IN_FRONT` is `false` for that tab's page while the sheet is up and `true` again once it is gone. Before, it stayed `true`, so a `<keyboard-dock>` on that page kept the keyboard under the sheet.
