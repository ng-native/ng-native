/**
 * The setup file `ngNative()` adds to Vitest: the globals the Metro preset installs as polyfills,
 * in place before a test file evaluates `@angular/core`. See `register.mjs` for why that order
 * matters and why `ngDevMode` is left alone.
 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach } from 'vitest';

createRequire(import.meta.url)('@ng-native/metro/polyfills/animation-globals.js');
// Metro's prelude defines this in every bundle, and app code reads it bare.
globalThis.__DEV__ ??= true;

// Tells `injectService` which test is running, so the app the calls in a test share is never
// another test's: how many tests have finished, and how many are running now. On the global, since
// this file and the package a test imports need not be one module instance.
const tests = (globalThis[Symbol.for('ng-native.testing.tests')] = { finished: 0, running: 0 });
beforeEach(() => {
  tests.running++;
});
afterEach(() => {
  tests.running--;
  tests.finished++;
});
