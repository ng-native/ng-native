---
__default__: patch
---

`@ng-native/testing`'s Node hook runs on Node 22 and early Node 24 releases, where every test file that compiled a component failed with `ERR_METHOD_NOT_IMPLEMENTED: The resolveSync() method is not implemented`.

The compiler the hook runs is CommonJS, and it `require`s two ES modules, `@oxc-angular/vite` and `@angular/compiler`. Those versions of Node cannot `require` an ES module that imports anything on the thread that runs `module.register`'s hooks, so `node --import @ng-native/testing/register --test`, and a suite that registers `@ng-native/testing/loader` itself, failed there. The hook now imports both before it is registered. Recent Node 24 releases and the Vitest plugin are unchanged.
