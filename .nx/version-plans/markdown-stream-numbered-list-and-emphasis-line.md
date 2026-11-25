---
__default__: patch
---

A streaming `markdown` no longer splits a numbered list with blank lines between its items in two where a chunk ends just after an item's number, before its `.` or `)`, and keeps a paragraph whole when its next line starts with three or more `*` or `_`, as in `***Note:***`.

Before, the stream kept such a block drawn as two until `streaming` was cleared, or until a chunk defined or changed a link reference. Now it holds back a last line of only a number, or of only three or more `*` or `_` with any spaces, until the line holds anything else or ends.
