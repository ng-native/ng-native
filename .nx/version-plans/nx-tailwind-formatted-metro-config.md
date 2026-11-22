---
__default__: patch
---

`nx g @ng-native/nx:tailwind` wraps an app's Metro config in `withTailwind` when its `module.exports` spans more than one line, as a newly generated app's does once it is formatted. Before, it warned it could not update `metro.config.js` and still added the `app.tailwind.js` import to `src/main.ts`, so the app's typecheck and bundle failed on a sheet nothing built. Where it cannot wrap the config, it now leaves `src/main.ts` as it is too.
