---
'__default__': patch
---

A list gaining or losing a row under a stylesheet that asks about the element just before (`+`) has only the rows next to the change styled again.

With a `.row + .row` rule in any stylesheet, which is how a list is often given its gaps and separators, a row added or removed restyled every row after it and everything under them. A `+` reads the one element before, so now a change restyles as many rows after it as a rule steps along: one for `.a + .b`, two for `.a + .b + .c`. A 300-row list of nine views a row under `.row + .row` gaining a row at its start goes from about 15.8ms to 0.46ms in Node with V8's optimising tiers off, and one in the middle from 8.1ms to 0.56ms. A stylesheet that asks about any earlier element (`~`) or counts from the start (`:nth-child()`) still restyles every row after the change.
