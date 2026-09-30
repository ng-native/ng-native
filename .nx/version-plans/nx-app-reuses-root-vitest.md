---
__default__: patch
---

`nx g @ng-native/nx:app` in a package-manager workspace now lists the root's Vitest, Angular and other shared dependencies in the app's `package.json` when Angular Native accepts them, instead of adding Vitest 5 beside a workspace's Vitest 4.
