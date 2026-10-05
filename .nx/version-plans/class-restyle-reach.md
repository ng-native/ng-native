---
'__default__': patch
---

A class set on an element restyles only what the stylesheet rules that name the class are written for, where it restyled the element and everything under it.

A class in no rule restyles nothing, and one named only as what a rule's element is inside, as `.busy .row` names `busy`, restyles the elements under it those rules are for. A component library that marks an overlay while it animates no longer restyles the whole overlay each time: opening Angular Material's datepicker restyled its 300 views twice over for two such classes. What is drawn is unchanged.
