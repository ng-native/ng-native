---
__default__: patch
---

An app from `nx g @ng-native/nx:app` now ignores `.angular-native/`, and its `typecheck` target, like the template's `typecheck` script, loads `metro.config.js` before `ngc`, so a typecheck on a fresh checkout passes once Tailwind is added.

The command is now `node metro.config.js && ngc -p tsconfig.json --noEmit`, which the Tailwind page documented as a manual change. Loading the config builds the sheet `src/main.ts` imports and exits, and it takes a fraction of a second without Tailwind. The app's `.gitignore` gains the template's `.angular-native/` entry beside `/ios` and `/android`. Existing apps are unchanged.

`nx add @ng-native/nx` also adds `@expo/metro` at the workspace root, at the range Expo depends on. `withNxMetro` looks for it from the app's directory up, and pnpm keeps it out of the root's `node_modules`, so with pnpm, loading the config with plain `node`, as the new `typecheck` target does, threw "Unable to load Metro config. Install `@expo/metro`". `expo start` was not affected, since pnpm's `expo` shim puts pnpm's hidden `node_modules` on `NODE_PATH`.
