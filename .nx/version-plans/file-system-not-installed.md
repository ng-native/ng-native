---
__default__: patch
---

`FileSystem.cache()` and `document()` throw `expo-file-system is not installed` where the module is
missing, as the documentation says, rather than a `TypeError` about reading `cacheDirectory` of
null.
