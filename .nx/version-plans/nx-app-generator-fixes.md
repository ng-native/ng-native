---
__default__: patch
---

`nx g @ng-native/nx:app` now writes an app that typechecks, resolves path aliases in tests without a warning and lints with the workspace's rules, and `desktop-only-events` no longer warns in an app that builds for no phone.

- In a workspace whose `tsconfig.base.json` sets `noPropertyAccessFromIndexSignature`, as Nx's Angular presets do, the app's `tsconfig.json` sets it back to `false`. Before, `src/main.ts` failed `nx typecheck` with TS4111 on `process.env.EXPO_PUBLIC_DEVICE_TESTS`, which has to stay a dot access for Expo's Babel preset to inline it.
- In a workspace with path aliases, the `vitest.config.mts` of an app or library sets Vite's own `resolve: { tsconfigPaths: true }` where the workspace's Vite is 8 or later or none is listed, and adds Vite 8 if there is none, instead of `vite-tsconfig-paths`, which Vite 8 warns about on every test run. A workspace whose Vite is older, or whose Vitest is older than 4.1 (which runs on its own Vite 6 or 7), keeps `vite-tsconfig-paths`.
- With `--linter=eslint`, an app in a workspace with an `eslint.config.mjs`, `.js` or `.cjs` at its root spreads that config before its own, so `@nx/enforce-module-boundaries` and the root's other rules apply to it. Before, `nx lint` passed what the root's ESLint run failed.
- `@ng-native/eslint-plugin`'s `desktop-only-events` does not warn in a project whose `expo.platforms` lists no `ios` or `android`, such as a `--desktopOnly` app, where the event fires on every OS it builds for. It warns again once a phone is listed.
