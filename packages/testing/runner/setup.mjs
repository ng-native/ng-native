/**
 * The setup file `ngNative()` adds to Vitest: the globals the Metro preset installs as polyfills,
 * in place before a test file evaluates `@angular/core`. See `register.mjs` for why that order
 * matters and why `ngDevMode` is left alone.
 */
import { createRequire } from 'node:module';
import { afterEach } from 'vitest';

createRequire(import.meta.url)('@ng-native/metro/polyfills/animation-globals.js');
// Metro's prelude defines this in every bundle, and app code reads it bare.
globalThis.__DEV__ ??= true;

// Tells `injectService` where one test ends and the next begins, so the app the calls in a test
// share is never the next test's. A number on the global, since this file and the package a test
// imports need not be one module instance.
const TEST = Symbol.for('ng-native.testing.test');
globalThis[TEST] = 0;
afterEach(() => {
  globalThis[TEST]++;
});
