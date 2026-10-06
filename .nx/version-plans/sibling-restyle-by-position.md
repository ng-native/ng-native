---
'__default__': patch
---

A list gaining or losing a row under a stylesheet that counts its children has only the rows the change can reach styled again.

With an `:nth-child()` rule in any stylesheet, or one that asks about the element before (`+`, `~`), a change to a child list restyled every child and everything under them. A row's place from the start hangs only on the rows before it, so now only the rows from the change on are styled again, with the two at each end: a row added at the end of a striped list restyles none of the rows before it. An `:nth-last-child()` rule is the other way about, and reaches the rows before the change. A 300-row list of nine views a row, striped with `:nth-child(odd)`, gaining a row at its end goes from about 19ms to 0.45ms in Node with V8's optimising tiers off, and one in the middle from 19ms to 9.4ms. A row added at the start still restyles every row, as do stylesheets that between them count from both ends.
