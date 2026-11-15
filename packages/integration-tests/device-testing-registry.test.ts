/**
 * The device test host's side of `@ng-native/testing/device`, against Metro's own module runtime:
 * defining what the pool sends, running again what an edit changed, isolation, and `vi.mock`.
 *
 * Metro's development runtime is plain JavaScript, so it runs here as it does in the app, with the
 * registry the host drives.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';
import { define, isolate, rerun } from '@ng-native/testing/device/loader';
import {
  installMocking,
  prepareMocks,
  restoreMocks,
} from '@ng-native/testing/device/mock-registry';

const GLOBALS = ['__DEV__', '__METRO_GLOBAL_PREFIX__', '__r', '__d', '__c', '__registerSegment'];
const scope = globalThis as Record<string, unknown>;
const saved = new Map(GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(scope, name)]));

before(() => {
  // React Native depends on Metro's runtime, the one the app runs.
  const runtime = createRequire(
    createRequire(import.meta.url).resolve('react-native/package.json'),
  ).resolve('metro-runtime/src/polyfills/require.js');
  scope['__DEV__'] = true;
  scope['__METRO_GLOBAL_PREFIX__'] = '';
  new Function('global', readFileSync(runtime, 'utf8'))(globalThis);
});

after(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(scope, name, descriptor);
    else delete scope[name];
  }
});

const metroRequire = (id: number) => (scope['__r'] as (id: number) => unknown)(id);

/** A module as Metro bundles one: its body gets `require` and its dependencies' ids. */
function source(id: number, deps: number[], name: string, body: string): string {
  return `__d(function (global, require, _i, _a, module, exports, _dependencyMap) {\n${body}\n},${id},[${deps.join(',')}],${JSON.stringify(name)});`;
}

/** What the pool sends for a test file whose module is `entry`. */
function payload(
  entry: number,
  modules: { id: number; code: string }[],
  options: { changed?: number[]; mocks?: Record<string, number> } = {},
) {
  let line = 0;
  return {
    entry,
    modules: modules.map(({ id, code }) => {
      const sent = { id, code, hash: String(code.length), line };
      line += code.split('\n').length;
      return sent;
    }),
    changed: options.changed ?? [],
    mocks: options.mocks ?? {},
    url: 'http://metro/test.bundle',
  };
}

/** A module exporting `value`, defined as Metro's export transform does: a getter, once. */
const exporting = (value: string) => `
Object.defineProperty(exports, '__esModule', { value: true });
Object.defineProperty(exports, 'value', { enumerable: true, get: function () { return ${JSON.stringify(value)}; } });
`;

describe("the device test host's module registry", () => {
  it('runs a test file again with the version of a dependency an edit changed', () => {
    const test = source(
      100,
      [101],
      'src/a.device.ts',
      'exports.seen = require(_dependencyMap[0]).value;',
    );
    define(payload(100, [
      { id: 100, code: test },
      { id: 101, code: source(101, [], 'src/dep.ts', exporting('one')) },
    ]));
    assert.equal((rerun(100) as { seen: string }).seen, 'one');

    define(payload(100, [{ id: 101, code: source(101, [], 'src/dep.ts', exporting('two')) }], {
      changed: [101],
    }));
    assert.equal((rerun(100) as { seen: string }).seen, 'two');
  });

  it('runs a module with exports again into a new exports object', () => {
    define(payload(110, [{ id: 110, code: source(110, [], 'src/b.ts', exporting('b')) }]));
    assert.equal((rerun(110) as { value: string }).value, 'b');
    // A second run on the same object would define its getter twice, which throws.
    assert.equal((rerun(110) as { value: string }).value, 'b');
  });

  it("runs the app's own modules afresh, and leaves packages alone", () => {
    const counter = (name: string) =>
      `exports.runs = (globalThis.__runs['${name}'] = (globalThis.__runs['${name}'] ?? 0) + 1);`;
    scope['__runs'] = {};
    try {
      define(payload(120, [
        { id: 120, code: source(120, [], 'src/state.ts', counter('app')) },
        { id: 121, code: source(121, [], '../../packages/x/src/index.ts', counter('package')) },
        { id: 122, code: source(122, [], '../../node_modules/y/index.js', counter('library')) },
      ]));
      for (const id of [120, 121, 122]) metroRequire(id);
      isolate((name) => !name.startsWith('../') && !name.includes('node_modules'));
      for (const id of [120, 121, 122]) metroRequire(id);
      assert.deepEqual(scope['__runs'], { app: 2, package: 1, library: 1 });
    } finally {
      delete scope['__runs'];
    }
  });
});

describe('vi.mock on a device', () => {
  const vi: Record<string, unknown> & { fn: () => () => string } = {
    fn: () => () => 'auto',
  };
  installMocking(vi as never);

  /**
   * A test file that mocks a module it reaches through another (as a test reaches a service
   * through the component it renders), with a hoisted value its factory and tests share.
   */
  const testFile = source(
    200,
    [202],
    'src/mock.device.ts',
    `
const vi = globalThis.__vi;
const shared = vi.hoisted(() => ({ made: Math.random() }));
vi.mock('./dep.ts', async (importOriginal) => {
  const real = await importOriginal();
  return { value: 'mocked over ' + real.value, shared };
});
const middle = require(_dependencyMap[0]);
exports.value = middle.value;
exports.factoryShared = middle.shared;
exports.testShared = shared;
`,
  );
  const dependency = source(201, [], 'src/dep.ts', exporting('real'));
  const middle = source(
    202,
    [201],
    'src/middle.ts',
    'const dep = require(_dependencyMap[0]); exports.value = dep.value; exports.shared = dep.shared;',
  );

  it('runs the file with its dependency mocked, and the real one back after', async () => {
    scope['__vi'] = vi;
    try {
      const sent = payload(
        200,
        [
          { id: 200, code: testFile },
          { id: 201, code: dependency },
          { id: 202, code: middle },
        ],
        {
          mocks: { './dep.ts': 201 },
        },
      );
      define(sent);
      await prepareMocks(sent.mocks, sent.entry, () => rerun(200));
      const run = rerun(200) as { value: string; factoryShared: unknown; testShared: unknown };
      assert.equal(run.value, 'mocked over real', 'the factory had the real module to build on');
      assert.equal(run.factoryShared, run.testShared, 'one hoisted value for the factory and test');

      restoreMocks();
      assert.equal((metroRequire(202) as { value: string }).value, 'real', 'and what imported it');
    } finally {
      restoreMocks();
      delete scope['__vi'];
    }
  });
});
