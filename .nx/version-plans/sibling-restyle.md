---
'__default__': patch
---

A list gaining or losing a row no longer has every row styled again where the stylesheets only ask which element is first and which is last.

With a `:first-child`, `:last-child`, `:only-child` or `:not(:last-child)` rule in any stylesheet, which Tailwind's `space-y-*` and `divide-y` are, a change to a child list restyled the parent and every child, and everything under them. Now only the two elements at each end are styled again, and the parent only when it stops or starts being empty. A 300-row list gaining a row goes from about 3.4ms to 0.15ms in Node. A stylesheet that counts (`:nth-child(odd)`) or asks about a neighbour (`+`, `~`) still has every child styled again.
