---
'@ng-native/migrate': patch
'@ng-native/nx': patch
---

The vitest-tsconfig-paths migration leaves path aliases to Vite's own resolve.tsconfigPaths where the workspace's Vite is 8 or later, as the generators do.

On a workspace whose root package.json lists Vite 8 or later (or no Vite) and no Vitest older than 4.1, it turns on `resolve: { tsconfigPaths: true }` in the Vitest configs the generators wrote and adds `vite` at `^8.0.0` when the workspace lists none, instead of importing `vite-tsconfig-paths`, which Vite 8 warns about. Older Vite, a Vitest older than 4.1 and a config that already has a `resolve` option keep the plugin. A config already on the plugin or on the option is not changed.
