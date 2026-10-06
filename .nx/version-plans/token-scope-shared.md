---
'__default__': patch
---

A stylesheet with a rule that gives every element the same custom properties, as Tailwind's base rule does, no longer has each element's custom properties copied.

Tailwind writes `--tw-translate-x: 0`, `--tw-blur: initial` and about forty more on `*`, so every element defined custom properties and each one copied the whole map in scope, a few hundred entries with a theme loaded, though almost none changed what its parent had. An element whose own definitions leave every custom property as its parent has it is now handed the parent's map. Mounting a page of about 1,100 views went from about 193ms to about 151ms in Node. What a `var()` reads does not change.
