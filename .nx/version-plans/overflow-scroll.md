---
__default__: patch
---

The engine can commit an element whose CSS says `overflow: auto` or `overflow: scroll` as a scroll view around one content view, so what overflows it scrolls as it does in a browser. The box, its size, border and background, is the scroll view's; its padding, gap and flex layout are the content view's. It applies only to an element a package marks with the new `scrollsOverflow` export from `@ng-native/fabric`, which nothing on its own calls yet, so an app's views are committed as they were and `overflow` stays layout alone for them.
