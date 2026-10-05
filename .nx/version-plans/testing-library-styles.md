---
__default__: patch
---

`ngNative()` from `@ng-native/testing/vitest` takes `libraryStyles`, the list of npm packages the Metro preset takes by the same name, and compiles those packages' component stylesheets in a test. Without it a library's components drew with no styles under Vitest, whatever the app's Metro config named.
