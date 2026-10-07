---
'__default__': patch
---

`:is(<scope> <compound>)` is read: the element itself, where it is somewhere under the scope.

A class written inside a scope and then named by a Tailwind variant, `in-data-[slot=dialog]:` or `rtl:` on a class under `.theme { ... }`, compiles to that shape, and the rule was dropped with a warning. Two compounds in front, or a child combinator, are still refused.
