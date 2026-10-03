---
__default__: patch
---

A service built on `database()` can be tested in Node: `openDatabasesWith()` from `@ng-native/expo/database` points every `database()` at a stand-in, and `memoryDatabase()` from `@ng-native/testing` is one that runs the migrations and the SQL for real, in memory.
