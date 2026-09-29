---
__default__: patch
---

`FileSystem.cache()` and `FileSystem.document()` now throw `[angular-native] expo-file-system is not installed` on the web and in a test with no fake source, as documented, instead of a `TypeError` about `cacheDirectory` or `documentDirectory`.
