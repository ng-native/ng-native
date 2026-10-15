---
'__default__': patch
---

`<markdown>` takes a `streaming` input for a source that arrives a chunk at a time, keeping the blocks before the last one and holding back what has not closed yet: a code span, emphasis, a link, an image, a table row or a code fence's opening line. A fenced block's code streams in once its opening line ends.

While `streaming` is set, only the last block is lexed again on a change, so the cost of a chunk does not grow with the length of the document, except for a chunk that defines or changes a link reference, which lexes the whole source again since it can change an earlier block. Clearing `streaming` draws the whole source as written. Streaming or not, a block that did not change keeps its native views, where before every block was drawn again on any change to the source. A paragraph or heading no longer carries the whitespace at its end, which it never drew.
