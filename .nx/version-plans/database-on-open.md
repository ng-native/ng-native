---
__default__: patch
---

`database()` takes an `onOpen` option, run on every open, before the migrations and outside any transaction, which is where `PRAGMA foreign_keys = ON` has to be said for a schema's foreign keys to be enforced.

A migration is the wrong place for it: SQLite ignores the statement inside a transaction, and forgets it when the connection closes. Foreign keys stay off unless `onOpen` turns them on, as with `expo-sqlite` itself.
