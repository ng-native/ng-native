---
__default__: patch
---

On macOS `Battery` answers from the desktop host's `NgNativeBattery`, over IOKit's power sources and Low Power Mode: `level`, `state`, `saving` and `low` follow the battery and the power adapter. On a Mac with no battery `known()` is false and `state()` is `unknown`.
