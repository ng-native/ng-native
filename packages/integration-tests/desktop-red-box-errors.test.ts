/**
 * The desktop host's dev red box hook (`packages/desktop/native/core/src/red-box-errors.js`), run as
 * the host runs it before the bundle: it reports what console.error and ErrorUtils' handler get, and
 * a value it cannot read never stops the saved console.error or the app's own handler.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../desktop/native/core/src/red-box-errors.js', import.meta.url),
  'utf8',
);

interface Hooked {
  reports: { message: string; stack: string; isFatal: boolean }[];
  logged: unknown[][];
  handled: unknown[];
  console: { error(...args: unknown[]): void };
  ErrorUtils: {
    setGlobalHandler(handler: (error: unknown, isFatal: boolean) => void): void;
    call(error: unknown): void;
  };
  // Evaluates code in the hook's realm, whose Error the hook recognises.
  run(code: string): unknown;
}

function hook(): Hooked {
  const logged: unknown[][] = [];
  const reports: Hooked['reports'] = [];
  const handled: unknown[] = [];
  let global: ((error: unknown, isFatal: boolean) => void) | undefined;
  const context = vm.createContext({
    console: { error: (...args: unknown[]) => logged.push(args) },
    ErrorUtils: {
      setGlobalHandler(handler: (error: unknown, isFatal: boolean) => void) {
        global = handler;
      },
    },
  });
  const install = vm.runInContext(source, context) as (
    report: (r: Hooked['reports'][0]) => void,
  ) => void;
  install((report) => reports.push(report));
  const utils = context['ErrorUtils'] as Hooked['ErrorUtils'];
  utils.setGlobalHandler((error) => handled.push(error));
  utils.call = (error) => global?.(error, true);
  return {
    reports,
    logged,
    handled,
    console: context['console'],
    ErrorUtils: utils,
    run: (code) => vm.runInContext(code, context),
  };
}

// An object that throws when the hook reads its stack, or turns it into text.
const unreadable = () => ({
  get stack(): string {
    throw new Error('stack');
  },
  toJSON() {
    throw new Error('json');
  },
  toString() {
    throw new Error('string');
  },
});

describe('the red box hook', () => {
  it('reports a console.error and still logs it', () => {
    const hooked = hook();
    const error = hooked.run("new Error('boom')");
    hooked.console.error(error);
    assert.equal(hooked.reports.length, 1);
    assert.equal(hooked.reports[0]?.message, 'Error: boom');
    assert.deepEqual(hooked.logged, [[error]]);
  });

  it('still logs a console.error whose value it cannot read', () => {
    const hooked = hook();
    const value = unreadable();
    assert.doesNotThrow(() => hooked.console.error(value));
    assert.deepEqual(hooked.logged, [[value]]);
  });

  it("still runs the app's handler for a thrown value it cannot read", () => {
    const hooked = hook();
    const value = unreadable();
    assert.doesNotThrow(() => hooked.ErrorUtils.call(value));
    assert.deepEqual(hooked.handled, [value]);
  });
});
