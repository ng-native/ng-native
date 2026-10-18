---
__default__: patch
---

Groundwork for drawing a library's inline `<svg>` natively with react-native-svg, painted by its stylesheet, which `@ng-native/web-compat` builds on. A renderer extension can answer `named(name, namespace)` for what an element written inside an `<svg>` stands for, and the shapes it creates are drawn as a browser draws them: paint handed down from a group, `currentColor`, no box on a shape, and a text's size and weight sent in its font on Android. `registerViewName` takes `spacedText` for a span that keeps its spaces, and `Engine.setTouchTarget` lets a package say which shape a touch is on. Nothing on main uses these yet, so `@ng-native/icons` icons and every other view render exactly as before.
