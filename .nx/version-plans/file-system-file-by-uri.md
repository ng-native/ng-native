---
__default__: patch
---

`FileSystem` has `file(uri)`, the file at a uri, so a document the picker answers with can be read: `files.file(picked.uri).text()`. A `FileSystem.SOURCE` stand-in opens one with `fileAt(uri)`.
