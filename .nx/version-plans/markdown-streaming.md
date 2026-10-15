---
'__default__': minor
---

`<markdown>` takes a `streaming` input for a source that arrives a chunk at a time, keeping the blocks before the last one and holding back a code span, emphasis, table row or code fence that has not closed yet.

While `streaming` is set, only the last block is lexed again on each change, so the cost of a chunk no longer grows with the length of the document; clearing it draws the whole source as written. Streaming or not, a block that did not change keeps its native views, where before every block was drawn again on any change to the source. A paragraph or heading no longer carries the whitespace at its end, which it never drew.
