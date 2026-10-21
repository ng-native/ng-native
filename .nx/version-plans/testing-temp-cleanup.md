---
__default__: patch
---

`ngNative()` removes the module copies a Vitest run leaves in the system temp directory when the run closes on Windows, as it already did on other platforms.
