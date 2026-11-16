---
__default__: patch
---

A streaming `markdown` element holds back a last line of only dashes or `=` (with pipes, colons and spaces) until the line ends, so the text above it stays a paragraph rather than flashing as a heading, and a table whose delimiter row starts with one dash (`- | -`) streams as a table rather than as a paragraph and a list.
