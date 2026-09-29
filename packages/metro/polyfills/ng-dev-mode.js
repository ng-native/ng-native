/**
 * Angular decides dev mode from a global: `initNgDevMode()` treats an *undefined* `ngDevMode` as
 * "dev" and installs its perf counters. The Angular CLI replaces the identifier with `false` at
 * build time; Metro does not, so without this a release bundle runs Angular with every dev-mode
 * assertion, check and error message live.
 *
 * Loaded as a Metro polyfill so it runs before @angular/core is evaluated.
 *
 * This switches the behaviour off; it does not shrink the bundle. `withAngularNative()` also folds
 * `ngDevMode` to `false` in Terser's `global_defs`, which strips the dead branches, and this covers
 * a release bundle that another minifier, or none, produced.
 */
if (typeof __DEV__ !== 'undefined' && !__DEV__) {
  globalThis.ngDevMode = false;
}
