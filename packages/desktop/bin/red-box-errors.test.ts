import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(
  new URL('../native/core/src/red-box-errors.js', import.meta.url),
  'utf8',
);

interface Report {
  message: string;
  stack: string;
  isFatal: boolean;
}

/**
 * A runtime as a dev run's is before the bundle: a console of its own (the debugger's), the hook
 * installed, then what React Native's polyfills and set-up do with console and ErrorUtils.
 */
function runtime(options: { console?: boolean } = {}) {
  const reports: Report[] = [];
  const logged: unknown[][] = [];
  const context = vm.createContext({ Error, JSON, String, Object, Array });
  if (options.console !== false) {
    context.console = { error: (...args: unknown[]) => logged.push(args) };
  }
  const install = vm.runInContext(script, context) as (report: (r: Report) => void) => void;
  // Copied out of the context, so they compare as this realm's objects.
  install((report) => reports.push(JSON.parse(JSON.stringify(report)) as Report));
  return { context, reports, logged };
}

/** React Native's console polyfill: a console of its own that calls the one it found. */
function consolePolyfill(context: vm.Context) {
  vm.runInContext(
    `(function () {
      var originalConsole = globalThis.console;
      globalThis.console = {
        error: function () { originalConsole.error.apply(originalConsole, arguments); },
      };
    })()`,
    context,
  );
}

/** The ErrorUtils polyfill, then setUpErrorHandling's handler, which logs with console.error. */
function errorUtils(context: vm.Context) {
  vm.runInContext(
    `(function () {
      var handler = null;
      globalThis.ErrorUtils = {
        setGlobalHandler: function (fn) { handler = fn; },
        getGlobalHandler: function () { return handler; },
        reportFatalError: function (e) { handler(e, true); },
        reportError: function (e) { handler(e, false); },
      };
      globalThis.ErrorUtils.setGlobalHandler(function (e, isFatal) { console.error(e); });
    })()`,
    context,
  );
}

describe('red-box-errors.js', () => {
  it('hands over console.error with the Error it was given, through the console polyfill', () => {
    const { context, reports, logged } = runtime();
    consolePolyfill(context);
    vm.runInContext(`console.error('ERROR', new Error('Soft error'))`, context);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.message, 'ERROR Error: Soft error');
    assert.match(reports[0]!.stack, /^Error: Soft error/);
    assert.equal(reports[0]!.isFatal, false);
    // The console it wrapped still gets the call.
    assert.equal(logged.length, 1);
  });

  it('hands over a message with no Error, and without a console of its own', () => {
    const { context, reports } = runtime({ console: false });
    consolePolyfill(context);
    vm.runInContext(`console.error('plain', 3, { a: 1 })`, context);
    assert.deepEqual(reports, [{ message: 'plain 3 {"a":1}', stack: '', isFatal: false }]);
  });

  it("hands over ErrorUtils' fatal and soft errors once each, not again as the handler logs them", () => {
    const { context, reports } = runtime();
    consolePolyfill(context);
    errorUtils(context);
    vm.runInContext(`ErrorUtils.reportFatalError(new Error('Fatal'))`, context);
    vm.runInContext(`ErrorUtils.reportError(new Error('Soft'))`, context);
    assert.deepEqual(
      reports.map((r) => [r.message, r.isFatal]),
      [
        ['Error: Fatal', true],
        ['Error: Soft', false],
      ],
    );
    // A console.error after the handler is reported again.
    vm.runInContext(`console.error('after')`, context);
    assert.equal(reports.at(-1)!.message, 'after');
  });

  it('keeps the handler working when reporting throws', () => {
    const context = vm.createContext({
      Error,
      JSON,
      String,
      Object,
      Array,
      console: { error() {} },
    });
    const install = vm.runInContext(script, context) as (report: () => void) => void;
    install(() => {
      throw new Error('host failed');
    });
    errorUtils(context);
    assert.doesNotThrow(() => vm.runInContext(`ErrorUtils.reportError(new Error('x'))`, context));
  });
});
