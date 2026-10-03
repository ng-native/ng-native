---
__default__: patch
---

`@ng-native/testing` exports `compileCss`, which compiles a stylesheet for `render()`'s `globalStyles`, so a test no longer reaches into `@ng-native/metro`, a path a test in a pnpm workspace library could not resolve.
