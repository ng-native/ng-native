---
__default__: patch
---

On macOS `StoreReview` answers from the desktop host's `NgNativeStoreReview`: in a Mac App Store (`mas`) build `available()` is true and `request()` asks for the system's rating prompt (unless the app runs with `NGN_NO_PROMPTS=1`), and in any other build, a sandboxed one included, it is inert. `storeUrl()` is null on macOS.
