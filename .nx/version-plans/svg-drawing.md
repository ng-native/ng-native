---
__default__: patch
---

A renderer extension can answer `named(name, namespace)` for what an element written inside an `<svg>` stands for, groundwork for drawing a library's inline `<svg>` natively with react-native-svg.

The shapes it creates are drawn as a browser draws them, painted by the library's stylesheet: paint handed down from a group, `currentColor`, no box on a shape, and a text's size and weight sent in its font on Android. `registerViewName` takes `spacedText` for a span that keeps its spaces, and `Engine.setTouchTarget` lets a package say which shape a touch is on. `@ng-native/web-compat` builds on these; `@ng-native/icons` icons and every other view render as before.
