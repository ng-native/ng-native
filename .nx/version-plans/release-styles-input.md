---
__default__: patch
---

A release build keeps an input whose class field is called `styles`, where it emptied the input's entry in the component definition along with the compiled CSS, so a binding to it did nothing.

The compiled CSS a release build drops is now read with a JavaScript parser and only the definition's own `styles` property is emptied, in the app's components and in a linked library's. A library opted in with `libraryStyles` is read the same way, so an input called `styles`, under an alias or with a transform, no longer fails the build or leaves the component without its sheet.
