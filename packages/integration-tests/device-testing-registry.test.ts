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

describe('vi.mock on a device, at its edges', () => {
  const vi: Record<string, unknown> & { fn: () => () => string } = {
    fn: () => () => 'auto',
  };
  installMocking(vi as never);
  const viOf = () => vi as unknown as Record<string, (...args: unknown[]) => unknown>;

  it('gives vi.hoisted its value in a file that mocks nothing', async () => {
    await prepareMocks({}, 400, () => assert.fail('nothing to hear'));
    assert.equal(
      viOf()['hoisted']!(() => 42),
      42,
    );
    restoreMocks();
  });

  it('runs a helper again that first ran while registration was closed', async () => {
    // A helper such as `export const test = base.extend({})`, first run in the pass that only
    // hears what the file mocks, holds what the closed gate gave it unless it runs again.
    scope['__gate'] = { closed: false };
    try {
      const vitestRuntime = source(
        410,
        [],
        'node_modules/.cache/ng-native-device-testing/vitest-4.0.0.cjs',
        'exports.test = { extend: () => (globalThis.__gate.closed ? "quiet" : "real") };',
      );
      const fixtures = source(
        411,
        [410],
        'src/fixtures.ts',
        'exports.test = require(_dependencyMap[0]).test.extend();',
      );
      const dep = source(412, [], 'src/dep.ts', exporting('real'));
      const file = source(
        413,
        [411, 412],
        'src/fixture.device.ts',
        'exports.test = require(_dependencyMap[0]).test; require(_dependencyMap[1]);',
      );
      const sent = payload(
        413,
        [
          { id: 410, code: vitestRuntime },
          { id: 411, code: fixtures },
          { id: 412, code: dep },
          { id: 413, code: file },
        ],
        { mocks: { './dep.ts': 412 } },
      );
      define(sent);
      metroRequire(410);
      await prepareMocks(sent.mocks, sent.entry, () => {
        (scope['__gate'] as { closed: boolean }).closed = true;
        try {
          viOf()['mock']!('./dep.ts', () => ({ value: 'mocked' }));
          rerun(413);
        } finally {
          (scope['__gate'] as { closed: boolean }).closed = false;
        }
      });
      assert.equal((rerun(413) as { test: string }).test, 'real');
    } finally {
      restoreMocks();
      delete scope['__gate'];
    }
  });

  it('keeps a mock out that an async factory finishes after vi.doUnmock', async () => {
    define(payload(420, [{ id: 420, code: source(420, [], 'src/late.ts', exporting('real')) }]));
    await prepareMocks({ './late.ts': 420 }, 420, () => {});
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    viOf()['doMock']!('./late.ts', async () => {
      await finished;
      return { value: 'mocked' };
    });
    viOf()['doUnmock']!('./late.ts');
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      assert.equal((metroRequire(420) as { value: string }).value, 'real');
    } finally {
      restoreMocks();
    }
  });

  it('automocks an array export as an empty array', async () => {
    const list = source(430, [], 'src/list.ts', 'exports.items = [1, 2, 3];');
    const sent = payload(
      431,
      [
        { id: 430, code: list },
        {
          id: 431,
          code: source(
            431,
            [430],
            'src/list.device.ts',
            'exports.items = require(_dependencyMap[0]).items;',
          ),
        },
      ],
      { mocks: { './list.ts': 430 } },
    );
    define(sent);
    try {
      await prepareMocks(sent.mocks, sent.entry, () => viOf()['mock']!('./list.ts'));
      const items = (rerun(431) as { items: unknown }).items;
      assert.ok(Array.isArray(items));
      assert.deepEqual(
        (items as number[]).map((n) => n),
        [],
      );
    } finally {
      restoreMocks();
    }
  });

  it('gives vi.importMock a mocked module where the file did not mock it', async () => {
    const sent = payload(440, [
      {
        id: 440,
        code: source(
          440,
          [],
          'src/tools.ts',
          'exports.add = (a, b) => a + b; exports.nested = { run: () => "real" };',
        ),
      },
    ]);
    define(sent);
    try {
      await prepareMocks({ './tools.ts': 440 }, 440, () => {});
      const mock = (await viOf()['importMock']!('./tools.ts')) as {
        add: () => string;
        nested: { run: () => string };
      };
      assert.equal(mock.add(), 'auto');
      assert.equal(mock.nested.run(), 'auto');
      assert.equal(
        (metroRequire(440) as { nested: { run: () => string } }).nested.run(),
        'real',
        'the module itself is left as it is',
      );
    } finally {
      restoreMocks();
    }
  });

  it('gives vi.importMock the factory of a vi.doMock still installing', async () => {
    define(payload(450, [{ id: 450, code: source(450, [], 'src/slow.ts', exporting('real')) }]));
    try {
      await prepareMocks({ './slow.ts': 450 }, 450, () => {});
      viOf()['doMock']!('./slow.ts', async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { value: 'mocked' };
      });
      const mock = (await viOf()['importMock']!('./slow.ts')) as { value: string };
      assert.equal(mock.value, 'mocked');
    } finally {
      restoreMocks();
    }
  });

  it('rejects vi.importMock when the vi.doMock factory still installing rejects', async () => {
    define(payload(451, [{ id: 451, code: source(451, [], 'src/bad.ts', exporting('real')) }]));
    try {
      await prepareMocks({ './bad.ts': 451 }, 451, () => {});
      viOf()['doMock']!('./bad.ts', async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw new Error('factory failed');
      });
      await assert.rejects(async () => viOf()['importMock']!('./bad.ts'), /factory failed/);
    } finally {
      restoreMocks();
    }
  });
});
