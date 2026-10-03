/**
 * `node --import @ng-native/testing/register --test` - compiles Angular for Node's own test
 * runner. See `loader.mjs`.
 *
 * The animation globals go in first, and have to: `@angular/core` decides whether `animate.enter`
 * and `animate.leave` do anything at all when it is first evaluated, so this is the last moment
 * that answer can be influenced. An app does the same thing with a Metro polyfill. `ngDevMode`
 * is left undefined, which Angular reads as dev mode - what a Metro dev build runs - and
 * `__DEV__` is true for the same reason.
 */
import { createRequire, register } from 'node:module';

createRequire(import.meta.url)('@ng-native/metro/polyfills/animation-globals.js');
// Metro's prelude defines this in every bundle, and app code reads it bare.
globalThis.__DEV__ ??= true;

register('./loader.mjs', import.meta.url);

// Tells `injectService` which test is running. See `setup.mjs`. Only under `node --test`: a hook
// starts the test runner, which a script run through this file is not for.
if (process.env.NODE_TEST_CONTEXT || process.execArgv.some((arg) => arg.startsWith('--test'))) {
  const { afterEach, beforeEach } = await import('node:test');
  const tests = (globalThis[Symbol.for('ng-native.testing.tests')] = { finished: 0, running: 0 });
  beforeEach(() => {
    tests.running++;
  });
  afterEach(() => {
    tests.running--;
    tests.finished++;
  });
}
