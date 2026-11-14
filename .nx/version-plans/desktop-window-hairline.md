---
__default__: patch
---

On macOS each window's `--hairline` is the one for the display that window is on, where every window followed the app's. A window keeps it as it moves to a display of another density; `hairlineTokens(pixelRatio)` in `@ng-native/device` gives the token for a pixel ratio.
