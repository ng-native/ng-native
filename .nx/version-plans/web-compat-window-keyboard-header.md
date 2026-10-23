---
__default__: patch
---

With `@ng-native/web-compat`, the window ends at the top of the keyboard while it is up and starts under the navigation header, so `innerHeight`, `visualViewport.height`, element and touch positions, `resize` and `document.body` follow both, and an overlay a library places in the window, such as an Angular Material menu or bottom sheet, stays out from under the keyboard and the header.
