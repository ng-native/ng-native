---
__default__: patch
---

In development, a hot swap that drops, renames or removes an `@font-face` rule now stops text being matched to that face, where it stayed matched until the app reloaded.

The face stays registered with the platform, which has no way to unregister one, but nothing names it.
