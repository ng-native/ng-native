---
'__default__': patch
---

Two components that each define `@keyframes` of the same name each play their own: an element's animation uses the keyframes of its own component's stylesheet where it has some by that name, as Angular scopes them in a browser, where the last stylesheet loaded used to win for both.
