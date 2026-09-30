---
__default__: patch
---

An app from `nx g @ng-native/nx:app` now ignores `.angular-native/`, and its `typecheck` target, like the template's `typecheck` script, loads `metro.config.js` before `ngc`, so a typecheck on a fresh checkout passes once Tailwind is added.

The command is now `node metro.config.js && ngc -p tsconfig.json --noEmit`, which the Tailwind page documented as a manual change. Loading the config builds the sheet `src/main.ts` imports and exits, and it takes a fraction of a second without Tailwind. The app's `.gitignore` gains the template's `.angular-native/` entry beside `/ios` and `/android`. Existing apps are unchanged.
