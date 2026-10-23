---
__default__: patch
---

`<ng-icon [svg]>` reads markup it is given in time that grows with the markup's length, broken markup included. Some broken shapes took time that grew with the square of their length, all on the JS thread, at about 5 seconds for 100 KB in V8 and longer in Hermes:

- a tag that never closes, `<a<a<a…`, or a tag name or the space before it with no `>` after;
- an attribute name with no `=` after it;
- a comment, a processing instruction or a CDATA section left open;
- a `transform` or `gradientTransform` with a word and no `(`, or brackets that never close.

Markup nested a few thousand elements deep overflowed the stack as it was drawn. Elements nested more than 32 deep are now left out of the drawing with everything inside them.

A comment, processing instruction or CDATA section left open now hides the rest of the markup, as it does in a browser. An attribute is read only after a space, a tab or a line break, as XML writes it. The markup of every icon in the `@ng-icons` sets reads as before.
