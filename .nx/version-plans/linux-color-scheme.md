---
__default__: patch
---

On Linux, `Appearance.getColorScheme()` and `@media (prefers-color-scheme: dark)` follow the desktop's light or dark style, from launch and as it changes.

Before, they started light whatever the desktop's style and did not follow it as it changed, so an app drew its light colours over libadwaita's dark chrome. Only `Appearance.setColorScheme` changed what they answered.
