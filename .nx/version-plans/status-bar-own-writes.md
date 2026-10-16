---
__default__: patch
---

On Android, a native stack screen now keeps a `statusBarStyle` or `statusBarHidden` that its page's host binding sets to the same value the app's `StatusBar` claim carries onto it, when that claim changes or is dropped. Such a value was taken off with the claim, so the bar followed the new claim, or went back to light text and shown. The router tells a screen's own status bar props from the claim's by whether its presentation or a host binding wrote them, as it already did for `navigationBarHidden`.
