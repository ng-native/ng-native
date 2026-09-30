---
__default__: patch
---

Under Vitest 4, a test that renders a component injecting a device service, such as `<text-input>`, no longer fails with "Unexpected token 'typeof'" when `@ng-native/*` is installed from npm.

`ngNative()` shadows the `require` Vitest 4 passes every module in `.js` files whose package is `"type": "module"`, as the published `@ng-native/*` packages are, as well as in `.ts`, `.mts` and `.mjs`. A `.js` file in a CommonJS package keeps its `require`. The hand-written `hide-require` plugin some apps added as a workaround can be removed.
