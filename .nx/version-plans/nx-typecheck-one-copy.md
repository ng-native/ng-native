---
__default__: patch
---

`nx typecheck` on an app generated in a workspace of package-manager links now checks its templates when pnpm has given a workspace library its own copy of `@ng-native/components`, where `ngc` stopped at `NG3004: Unable to import symbol` and reported none of the app's template errors.

The app generator writes `tsconfig.typecheck.json`, which maps every `@ng-native` package to the app's own copy, and points the `typecheck` target at it. An existing app takes the same file by hand: the Nx page has it.
