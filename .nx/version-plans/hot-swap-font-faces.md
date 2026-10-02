---
__default__: patch
---

In development, a hot swap that drops, renames or removes an `@font-face` rule now stops text being matched to that face, where it stayed matched until the app reloaded.

The face stays registered with the platform, which has no way to unregister one. A face that declares a weight or style is registered under a name of its own, which nothing names any more; one that declares neither is registered under the family's own name, so text naming that family draws it until the app reloads.
