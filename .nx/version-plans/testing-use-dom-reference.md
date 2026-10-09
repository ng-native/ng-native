---
'__default__': patch
---

A test that imports a DOM component's `'use dom'` file gets a reference to its page, as native code does in a Metro bundle, under `ngNative()` and under `@ng-native/testing/register`.

The file was evaluated in Node instead, so `mountInWebView` failed as it was imported with "window is not defined", which Vitest reports as an unhandled rejection that fails a run whose tests all pass, and the page's web-only imports were loaded into the test run.
