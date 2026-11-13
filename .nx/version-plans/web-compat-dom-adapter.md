---
__default__: patch
---

With `@ng-native/web-compat`, Angular's DOM adapter (`getDOM()`) is now set once an app that asked for the package is up, where the app has set none of its own, so Angular's `Meta` adds, finds, updates and removes its `<meta>` tags in the document's head, and `document.title` reads and writes the first `<title>`, which Angular's `Title` sets.

`getDOM()` was null under Angular Native, so `Meta.addTag()`, `updateTag()` for a tag not yet there and `removeTag()` threw, as did code that calls them, such as Taiga UI's `provideTaiga()` for its font scaling, and `Title.setTitle()` wrote a property no `<title>` element held. The adapter creates elements and documents, dispatches events and adds and removes listeners, removes an element, finds the window, the document and the body, and answers the user agent and the path of a `<base href>` in the head. It finds no shadow root and no cookie. Angular takes a DOM adapter once and never gives it back, so this one stays once the last app has gone; it keeps nothing of an app, reading the global `document`, which is the newest app's, each time it is asked. An adapter the app has already set is left alone.
