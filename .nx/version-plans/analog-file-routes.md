---
__default__: minor
---

`@ng-native/analog`, a new package, routes an app with Analog's file-based pages: the pages in `src/app/pages`, found by Metro's `require.context` and routed by `createRoutes` from `@analogjs/router` itself, on a native stack.

`pageRoutes(pages)` takes the `require.context` of the pages, or an `import.meta.glob` of them in a Vitest test, and returns the routes for `provideNativeRouter`, with `[id]` parameters, `(group)` folders, layouts and each page's `routeMeta` as Analog has them. `withAnalog(config)` from `@ng-native/analog/metro` turns on `require.context` and resolves `@analogjs/router`'s import of `@analogjs/content`, which only a Markdown page needs, to an empty module, so the bundle leaves it out whether or not the package manager installed it. `examples/analog` is a showroom of each of these features.
