---
__default__: patch
---

A bound style declaration whose value is a `var()`, `[style.background-color]="'var(--surface)'"`, reads the token in scope and follows it, where the text `var(--surface)` was sent to native.

The whole value has to be the `var()`, with its fallback if it has one. It is settled as the same declaration in a stylesheet is: inherited where the property is, and reported in development when the token is unset with nothing to fall back to.
