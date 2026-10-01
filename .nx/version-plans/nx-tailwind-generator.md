---
__default__: patch
---

`@ng-native/nx` has a new generator, `nx g @ng-native/nx:tailwind <app> --library <library>`, which sets up Tailwind in an app and shares each named library's theme and classes with it.

For the app it writes `src/styles.css`, wraps `metro.config.js` in `withTailwind`, passes the generated sheet to `mount` as `globalStyles`, adds `@ng-native/tailwind` and Tailwind, and makes sure `typecheck` builds the sheet first and `.gitignore` ignores `.angular-native/`. With Tailwind 4, each library gets a `theme.css` with `@source` that the app imports. With Tailwind 3 (`--tailwindVersion=3`, or a workspace that has it), each library gets a `tailwind.preset.cjs` whose `content` the app's config spreads in, and `@nx/enforce-module-boundaries` allows requiring it. Running it again changes nothing.
