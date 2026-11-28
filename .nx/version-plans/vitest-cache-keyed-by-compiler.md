---
__default__: patch
---

`@ng-native/testing`'s Vitest plugin now keys Vitest's cache of compiled modules by the compiler in `@ng-native/metro` and by the libraries and directories `@ng-native/web-compat` reads as a browser's. A test run after either changed compiled each module again only where its own text had changed, and the rest ran what the old compiler made of them.
