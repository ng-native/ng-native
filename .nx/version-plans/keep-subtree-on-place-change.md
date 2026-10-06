---
'__default__': patch
---

A row whose place in a list changed keeps its style, and everything under it is left alone, where it still matches the rules it did.

A row added or removed under a stylesheet that counts its children (`:nth-child()`) or asks about earlier ones (`~`, which is every Tailwind `peer-*` variant) had every row its place could reach styled again, and everything under each. Those rows are now matched again, and one that matches the rules it did keeps its style and its subtree. A 300-row list of nine views a row gaining a row at its start goes from about 15ms to 0.8ms under `.row ~ .row` and from 19ms to 4ms under `.row:nth-child(3)`, in Node with V8's optimising tiers off. A list whose every row matches differently after the change, as stripes from `:nth-child(odd)` do, costs what it did. So does one under a rule that reads a row's place from inside the row, such as `.row:nth-child(odd) .label` or `.a + .b .c`: the rows such a rule could mean are styled again with everything under them, as before.
