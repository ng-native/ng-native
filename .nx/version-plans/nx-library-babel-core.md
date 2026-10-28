---
__default__: patch
---

`nx g @ng-native/nx:library` in the TypeScript preset adds the app's Babel 7 `@babel/core` to the library's dev dependencies, so pnpm 10 no longer prints "Failed to create bin" for `expo` and unmet `@babel/core` peers on every install.

`@angular/compiler-cli` depends on Babel 8, which otherwise answered React Native's `@babel/core` peer in the library under pnpm 10, giving the library its own copies of `react-native` and `expo`. pnpm 11 resolves the peer to the root's Babel 7 already. A library generated before this can add `"@babel/core": "^7.29.7"` to its `devDependencies` by hand.
