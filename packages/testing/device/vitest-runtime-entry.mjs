// What a device runs of Vitest: its runner, and what a test file imports from `vitest`. Bundled by
// metro.cjs for the app's own Vitest version.
import * as vitest from 'vitest';

export { collectTests, setupCommonEnv, startTests } from 'vitest/internal/browser';
export * from 'vitest';

/**
 * Whatever is reached through the gate while it is closed: callable, and each property of it the
 * same, so `it.each(cases)('name', fn)` and `describe.skip(...)` do nothing too.
 */
const quiet = new Proxy(function quiet() {}, { get: () => quiet, apply: () => quiet });
let closed = false;

/**
 * Close the gate on registering tests and hooks while a test file runs only so the host can hear
 * which modules it mocks (see the host's mock registry), and open it again.
 */
export function silenceRegistration(silent) {
  closed = silent;
}

const gate = (api) =>
  api &&
  new Proxy(api, {
    apply: (target, self, args) => (closed ? quiet : Reflect.apply(target, self, args)),
    get: (target, key) => (closed ? quiet : Reflect.get(target, key)),
  });

// Explicit exports win over the `export *` above for these names.
export const describe = gate(vitest.describe);
export const suite = gate(vitest.suite);
export const it = gate(vitest.it);
export const test = gate(vitest.test);
export const bench = gate(vitest.bench);
export const beforeAll = gate(vitest.beforeAll);
export const afterAll = gate(vitest.afterAll);
export const beforeEach = gate(vitest.beforeEach);
export const afterEach = gate(vitest.afterEach);
export const onTestFailed = gate(vitest.onTestFailed);
export const onTestFinished = gate(vitest.onTestFinished);
