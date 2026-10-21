---
__default__: patch
---

In an app with `@ng-native/web-compat`, HTML's inline elements (a span, a label, a button) and a library's custom elements are laid out inline as a browser lays them out, so what a label holds sits on one line: a required field's label shows its words and its marker side by side, where they were stacked and the floated label lost its words.
