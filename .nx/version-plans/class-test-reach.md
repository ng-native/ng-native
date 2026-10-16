---
__default__: patch
---

A class changing restyles only what a test of the class attribute, such as `[class^="p-"]`, or a `:has()` naming it can reach, where any class change under such a test restyled the element and everything under it.

A test of the class attribute now reaches what a class written in its place would: the element, or the elements a rule is for under it. A class or class test named only inside `:has()` asks the boxes above the element again and matches nothing under it again. A `:has()` such as `.p-floatlabel:has([class^='p-'][class$='-fluid'])` no longer has a class added to the root restyle the whole screen.
