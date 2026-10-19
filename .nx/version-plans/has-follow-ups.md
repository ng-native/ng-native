---
__default__: patch
---

A component's host is matched again when a class its own `:has()` names comes or goes, and a `:has()` rule is asked only of a box with the classes and element it names.

`:where(.group)` and `tr` are among the elements it names, and `:has(> )` is asked only of the box
right above the change. An element keeps no record of the rules it matched once no sheet in play
asks for one.
