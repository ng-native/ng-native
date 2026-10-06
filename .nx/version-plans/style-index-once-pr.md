---
'__default__': patch
---

A screen of a component library's components is styled faster on its first render.

A library adds a stylesheet for each of its components as the component first renders, and each one had every stylesheet filed again, for every pair of component sheets on the screen. Each sheet's rules are now filed once and a later sheet is added to what is there. A rule that names no class, id or element of its own but says whose child it is, `.row > *`, or is a bare `:is(.a, .b)`, is offered only to the elements it could match, where it was tried against every element. Mounting a page of about 1,100 views from Angular Material went from about 305ms to about 208ms in Node. What an element is styled with does not change.
