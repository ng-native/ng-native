---
__default__: patch
---

On macOS `StoreReview` answers from the desktop host's `NgNativeStoreReview`: in a Mac App Store (`mas`) build `available()` is true and `request()` asks for the system's rating prompt, and in any other build it is inert, where it threw `MissingModuleError` before. `storeUrl()` is null on macOS.
