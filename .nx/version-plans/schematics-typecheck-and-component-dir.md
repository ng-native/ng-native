---
__default__: patch
---

An Angular CLI workspace's native project gets a `typecheck` target, `ng run native:typecheck`, which runs `ngc` on its code and templates, and `ng generate component` writes into the project's `src/app`.

`ng add @ng-native/schematics` and `ng generate @ng-native/schematics:application` write the target, run by the new `@ng-native/schematics:typecheck` builder: it loads the project's `metro.config.js`, so a Tailwind sheet `src/main.ts` imports exists, then runs `ngc -p tsconfig.json --noEmit`. The `native-typecheck-target` migration, which `ng update @ng-native/schematics` runs, adds it to each existing native project in `angular.json` that has no `typecheck` target. An `angular.json` with comments or trailing commas is left as it is, with a note saying what to add. A component generated from the project's own directory, the workspace root or outside the project now goes in `src/app/<name>`, beside `app.ts`, rather than at the project's root. Run from a directory inside `src`, it still goes there.
