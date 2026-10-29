/**
 * The Vitest plugin hides CommonJS `require` from the modules it transforms, on every Vitest.
 *
 * Code here probes `typeof require` to tell a device from Node: given one, it requires
 * `react-native` or an Expo module, whose Flow source nothing in a test can parse. Vitest 5 has
 * `injectCjsGlobals: false` to leave it out; Vitest 4 has no such option and always passes one
 * in, so a routing test failed with "Unexpected token 'typeof'". The plugin now shadows it itself.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import { pathToFileURL } from 'node:url';
import { ngNative, standIn } from '../runner/vitest.mjs';

type Transform = (source: string, id: string) => { code: string } | string | null;

it('shadows an injected require in a module that probes for one', () => {
  const transform = ngNative().transform as unknown as Transform;
  const source =
    "export const found = typeof require === 'function' ? require('react-native') : null;";
  const result = transform(source, '/app/src/device.ts');
  const code = typeof result === 'string' ? result : (result?.code ?? source);

  // Vitest 4 evaluates a module inside a function that is handed `require`, as this does.
  const exports: { found?: unknown } = {};
  const body = code.replace('export const found', 'exports.found');
  new Function('require', 'exports', body)(() => 'react-native loaded', exports);
  assert.equal(exports.found, null);
});

/**
 * Metro hands native code a reference to a DOM component's page in place of the file, so none of
 * the page reaches the bundle. A test evaluated the file instead, and `mountInWebView` failed as
 * it was imported with "window is not defined".
 */
describe("a 'use dom' file", () => {
  const transform = ngNative().transform as unknown as Transform;
  const code = (source: string, id: string): string => {
    const result = transform(source, id);
    return typeof result === 'string' ? result : (result?.code ?? source);
  };

  it('is a reference to its page, as in a native bundle, and none of the page is loaded', () => {
    const source = [
      '// A chart.',
      "'use dom';",
      "import { Chart } from 'a-charting-library';",
      "import { mountInWebView } from '@ng-native/web/web-view';",
      'export default mountInWebView(Chart);',
    ].join('\n');
    const file = '/app/src/web/chart.dom.ts';
    const out = code(source, file);
    assert.doesNotMatch(out, /mountInWebView|a-charting-library/);
    const exports: { default?: { domComponent: string } } = {};
    new Function('exports', out.replace('export default', 'exports.default ='))(exports);
    assert.equal(exports.default?.domComponent, `chart.dom.ts?file=${pathToFileURL(file).href}`);
  });

  it("is left alone when it mounts nothing, which is a React DOM component and Expo's", () => {
    const source = "'use dom';\nexport default function Chart() { return null; }";
    assert.equal(code(source, '/app/src/web/chart.js'), source);
  });

  it('is left alone when the directive is not its first statement', () => {
    const source = "export const dom = 'use dom';\nexport const mount = () => mountInWebView(1);";
    assert.equal(code(source, '/app/src/web/chart.js'), source);
  });
});

/**
 * A published `@ng-native/*` package is built `.js` in a `"type": "module"` package, and one a
 * test imports from `node_modules` went unshadowed, so `<text-input>`, which injects a device
 * service, failed with "Unexpected token 'typeof'" under Vitest 4.
 */
describe('a built .js file', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-built-')));
  const probe =
    "export const found = typeof require === 'function' ? require('react-native') : null;";
  const install = (name: string, manifest: object): string => {
    const at = path.join(dir, 'node_modules', name);
    mkdirSync(path.join(at, 'dist'), { recursive: true });
    writeFileSync(path.join(at, 'package.json'), JSON.stringify({ name, ...manifest }));
    const file = path.join(at, 'dist/react-native.js');
    writeFileSync(file, probe);
    return file;
  };
  const evaluate = (file: string): unknown => {
    const transform = ngNative().transform as unknown as Transform;
    const result = transform(probe, file);
    const code = typeof result === 'string' ? result : (result?.code ?? probe);
    const exports: { found?: unknown } = {};
    const body = code.replace('export const found', 'exports.found');
    new Function('require', 'exports', body)(() => 'react-native loaded', exports);
    return exports.found;
  };

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('shadows require in an ES module package, as the published @ng-native ones are', () => {
    assert.equal(evaluate(install('@ng-native/device', { type: 'module' })), null);
  });

  it('leaves require to a CommonJS package, which needs the real one', () => {
    assert.equal(evaluate(install('commonjs-lib', {})), 'react-native loaded');
  });
});

it('fails a component whose template the compiler would cut short, rather than rendering half', () => {
  // `@if (on() {` compiled to the elements before it and nothing after, and the render passed.
  const transform = ngNative().transform as unknown as Transform;
  const source =
    "import { Component } from '@angular/core';\n" +
    "@Component({ selector: 'x-cut', template: '<text>a</text> @if (on() { <text>b</text> }' })\n" +
    'export class Cut { on() { return true; } }\n';
  assert.throws(
    () => transform(source, '/app/src/cut.ts'),
    /Cut's template does not parse: Incomplete block "if"/,
  );
});

describe("a library's own component styles", () => {
  // As npm ships one: partial-compiled, its CSS a string in the declaration.
  const CHIP = `import * as i0 from '@angular/core';
export class Chip {
  static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "22.0.0", ngImport: i0, type: Chip, deps: [], target: i0.ɵɵFactoryTarget.Component });
  static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "22.0.0", type: Chip, isStandalone: true, selector: "acme-chip", ngImport: i0, template: "<text>chip</text>", isInline: true, styles: [":host { padding: 4px }"] });
}`;
  const FILE = '/app/node_modules/@acme/ui/fesm2022/acme-ui.mjs';
  const compiled = (options?: Parameters<typeof ngNative>[0]): string => {
    const result = (ngNative(options).transform as unknown as Transform)(CHIP, FILE);
    return typeof result === 'string' ? result : (result?.code ?? CHIP);
  };

  it('are compiled for a package named in libraryStyles, as the Metro preset compiles them', () => {
    const code = compiled({ libraryStyles: ['@acme/ui'] });
    assert.match(code, /ɵnativeStyles/);
    assert.match(code, /"paddingTop":4/);
  });

  it('are compiled for every package with no list at all', () => {
    assert.match(compiled(), /ɵnativeStyles/);
  });

  it('are left out for a package a list does not name, and for every package for `false` or an empty list', () => {
    assert.doesNotMatch(compiled({ libraryStyles: ['@acme/other'] }), /ɵnativeStyles/);
    assert.doesNotMatch(compiled({ libraryStyles: false }), /ɵnativeStyles/);
    assert.doesNotMatch(compiled({ libraryStyles: [] }), /ɵnativeStyles/);
  });
});

it('leaves a module that never mentions require alone', () => {
  const transform = ngNative().transform as unknown as Transform;
  assert.equal(transform('export const a = 1;', '/app/src/a.ts'), null);
});

it('leaves a module that declares its own require alone', () => {
  // A test file that makes one with `createRequire`, which a shadow would redeclare.
  const transform = ngNative().transform as unknown as Transform;
  const source =
    "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nrequire('x');";
  assert.equal(transform(source, '/app/src/a.test.ts'), null);
});

it("resolves with the project's tsconfig customConditions, beside Vite's own", () => {
  // Nx's TypeScript preset exports a library's source only under a custom condition, and a test
  // that imported one failed to resolve its entry.
  const root = mkdtempSync(path.join(tmpdir(), 'ng-native-conditions-'));
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { customConditions: ['react-native', '@org/source'] } }),
  );
  try {
    const plugin = ngNative() as unknown as {
      config(config: { root?: string }): {
        resolve?: { conditions?: string[] };
        ssr?: { resolve?: { conditions?: string[] } };
      };
    };
    const config = plugin.config({ root });
    assert.equal(config.ssr?.resolve?.conditions?.[0], '@org/source');
    assert.ok(config.ssr?.resolve?.conditions?.includes('node'));
    assert.equal(config.resolve?.conditions?.[0], '@org/source');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * pnpm installs a package once per set of peers it resolves, so a workspace library that lists
 * `@ng-native/components` beside an app installed before it gets a copy of its own at the same
 * version. Metro takes the app's copy (see the Metro preset); Vite resolved the library's, so a
 * test that rendered a library component had two component registries.
 */
describe("a package a workspace library installed in a copy of its own, through Vite's resolver", () => {
  const ws = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-app-copy-')));
  const app = path.join(ws, 'apps/mobile');
  const library = path.join(ws, 'libs/button');
  const libraryFile = path.join(library, 'src/index.ts');
  let server: ViteDevServer;

  const install = (at: string, name: string, version: string, imports = '') => {
    const dir = path.join(at, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version, main: 'index.js' }),
    );
    writeFileSync(path.join(dir, 'index.js'), imports);
    writeFileSync(path.join(dir, 'sub.js'), '');
  };
  const resolve = async (source: string, importer = libraryFile) => {
    const id = (await server.environments.ssr!.pluginContainer.resolveId(source, importer))?.id;
    // Vite returns some package paths with `/`, even on Windows.
    return id === undefined ? undefined : path.normalize(id);
  };

  before(async () => {
    for (const [dir, name] of [
      [app, 'mobile'],
      [library, '@scratch/button'],
    ] as const) {
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
    }
    writeFileSync(libraryFile, '');
    for (const at of [app, library]) {
      install(at, '@scope/pkg', '1.0.0', "import '@scope/dep';");
      install(at, '@scope/dep', '1.0.0');
    }
    install(app, '@scope/other', '1.0.0');
    install(library, '@scope/other', '2.0.0');
    install(library, '@scope/lonely', '1.0.0');
    // A subpath the library's version exports and the app's does not, so the app's lookup throws.
    install(app, '@scope/exports', '1.0.0');
    install(library, '@scope/exports', '2.0.0');
    for (const [at, exports] of [
      [app, { '.': './index.js' }],
      [library, { '.': './index.js', './feature': './sub.js' }],
    ] as const) {
      const manifest = path.join(at, 'node_modules/@scope/exports/package.json');
      writeFileSync(
        manifest,
        JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), exports }),
      );
    }
    // A workspace package the app links from its source folder: its real path has no
    // node_modules in it.
    const linked = path.join(ws, 'packages/linked');
    mkdirSync(linked, { recursive: true });
    writeFileSync(
      path.join(linked, 'package.json'),
      JSON.stringify({ name: '@scope/linked', version: '1.0.0', main: 'index.js' }),
    );
    writeFileSync(path.join(linked, 'index.js'), '');
    symlinkSync(
      linked,
      path.join(app, 'node_modules/@scope/linked'),
      // A junction on Windows, which needs no privileges; ignored elsewhere.
      'junction',
    );
    install(library, '@scope/linked', '1.0.0');

    server = await createServer({
      root: app,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [ngNative()],
    });
  });

  after(async () => {
    await server?.close();
    rmSync(ws, { recursive: true, force: true });
  });

  it("resolves to the app's copy from the library", async () => {
    assert.equal(await resolve('@scope/pkg'), path.join(app, 'node_modules/@scope/pkg/index.js'));
  });

  it("resolves a subpath to the app's copy too", async () => {
    assert.equal(
      await resolve('@scope/pkg/sub.js'),
      path.join(app, 'node_modules/@scope/pkg/sub.js'),
    );
  });

  it("resolves to the app's copy from inside a package in the library's context", async () => {
    const inside = path.join(library, 'node_modules/@scope/pkg/index.js');
    assert.equal(
      await resolve('@scope/dep', inside),
      path.join(app, 'node_modules/@scope/dep/index.js'),
    );
  });

  it("resolves to the app's copy when the app's is a linked workspace package", async () => {
    assert.equal(await resolve('@scope/linked'), path.join(ws, 'packages/linked/index.js'));
  });

  it('keeps the copy a library resolves at a version of its own', async () => {
    assert.equal(
      await resolve('@scope/other'),
      path.join(library, 'node_modules/@scope/other/index.js'),
    );
  });

  it('keeps the copy a library resolves when the app has none', async () => {
    assert.equal(
      await resolve('@scope/lonely'),
      path.join(library, 'node_modules/@scope/lonely/index.js'),
    );
  });

  it("keeps the copy a library resolves when the app's version does not export the subpath", async () => {
    assert.equal(
      await resolve('@scope/exports/feature'),
      path.join(library, 'node_modules/@scope/exports/sub.js'),
    );
  });
});

/**
 * The stand-ins for gestures, Reanimated and worklets. The published package ships `dist` and
 * `runner` and no `src`, so a path built from the source tree exists only in the repository.
 */
describe('a stand-in module', () => {
  const names = ['gestures', 'gesture-handler', 'reanimated', 'reanimated-library'];
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-stand-in-')));
    mkdirSync(path.join(root, 'runner'));
    mkdirSync(path.join(root, 'dist'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('is the compiled file where the package has no source, as published', () => {
    const runner = pathToFileURL(path.join(root, 'runner', 'vitest.mjs'));
    for (const name of [...names, 'worklets-library']) {
      assert.equal(standIn(name, runner), path.join(root, 'dist', `${name}.js`));
    }
  });

  it('is the source in the repository, and every one of them is there', () => {
    for (const name of [...names, 'worklets-library']) {
      const file = standIn(name);
      assert.equal(file, path.join(import.meta.dirname, `${name}.ts`));
      assert.doesNotThrow(() => readFileSync(file), name);
    }
  });

  it('is a file the build emits, by the same name', () => {
    const build = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'tsconfig.build.json'), 'utf8'),
    ) as { include: string[]; compilerOptions: { rootDir: string; outDir: string } };
    assert.deepEqual(build.include, ['src']);
    assert.deepEqual(build.compilerOptions, { rootDir: 'src', outDir: 'dist' });
  });
});

/**
 * Vitest copies every module it runs into a directory of its own in the system temp directory, for
 * the forks pool, and with no `projects` in the config it never removed it: a hundred megabytes
 * left by each run of an app's suite.
 */
describe('a Vitest run', () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-vitest-run-')));
    writeFileSync(
      path.join(root, 'sum.test.ts'),
      "import { expect, it } from 'vitest';\nit('adds', () => expect(1 + 1).toBe(2));\n",
    );
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  /** Runs `intl.test.ts`, which passes when `Intl.RelativeTimeFormat` is `expected`. */
  async function intlRun(
    expected: string,
    options?: Parameters<typeof ngNative>[0],
    setupFiles: string[] = [],
  ) {
    writeFileSync(
      path.join(root, 'intl.test.ts'),
      "import { expect, it } from 'vitest';\n" +
        `it('has it or not', () => expect(typeof Intl.RelativeTimeFormat).toBe('${expected}'));\n`,
    );
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest(
      'test',
      { root, config: false, watch: false, reporters: [], include: ['intl.test.ts'], setupFiles },
      { plugins: [ngNative(options)] },
    );
    try {
      await vitest.start();
      return vitest.state.getCountOfFailedTests();
    } finally {
      await vitest.close();
      rmSync(path.join(root, 'intl.test.ts'), { force: true });
    }
  }

  it('runs without the Intl constructors Hermes lacks', async () => {
    assert.equal(await intlRun('undefined'), 0);
  });

  it("keeps Node's Intl for intl: 'node', for an app that polyfills what Hermes lacks", async () => {
    assert.equal(await intlRun('function', { intl: 'node' }), 0);
  });

  it("keeps a polyfill the app's own setup file installs where Intl lacks one", async () => {
    const polyfill = path.join(root, 'polyfill.ts');
    writeFileSync(
      polyfill,
      "if (!('RelativeTimeFormat' in Intl)) Object.assign(Intl, { RelativeTimeFormat: class {} });\n",
    );
    try {
      assert.equal(await intlRun('function', {}, [polyfill]), 0);
    } finally {
      rmSync(polyfill, { force: true });
    }
  });

  it('leaves no copy of the modules it ran in the temp directory', async () => {
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest(
      'test',
      { root, config: false, watch: false, pool: 'forks', reporters: [] },
      { plugins: [ngNative()] },
    );
    const copies = (vitest as unknown as { _tmpDir: string })._tmpDir;
    try {
      await vitest.start();
      assert.equal(vitest.state.getCountOfFailedTests(), 0);
      // The run did copy modules there, so the check below is not of a directory never made.
      assert.ok(existsSync(path.join(copies, 'ssr')), copies);
      await vitest.close();
      assert.equal(existsSync(copies), false, copies);
    } finally {
      await vitest.close();
      rmSync(copies, { recursive: true, force: true });
    }
  });
});

/**
 * An Angular library in `node_modules` that `ngNative()` was not told about. Vitest handed it to
 * Node, whose `@angular/core` is a second instance beside the one the test loads through the
 * plugin, so the library's `inject()` found no injection context: NG0203, as with
 * `injectQuery()` from `@tanstack/angular-query-experimental`.
 */
describe('an Angular library in node_modules', () => {
  let root: string;

  /** An `inject()` helper, as `injectQuery()` is. */
  const helper =
    "import { inject, InjectionToken } from '@angular/core';\n" +
    "export const GREETING = new InjectionToken('GREETING');\n" +
    'export function injectGreeting() {\n  return inject(GREETING);\n}\n';

  /** A test that calls the helper of `library` in a field initializer. */
  const helperTest = (library: string) =>
    "import { Injector } from '@angular/core';\n" +
    `import { GREETING, injectGreeting } from '${library}';\n` +
    "import { expect, it } from 'vitest';\n" +
    'class Greeter {\n  readonly greeting = injectGreeting();\n}\n' +
    "it('injects from the library in a field initializer', () => {\n" +
    '  const injector = Injector.create({\n' +
    "    providers: [{ provide: GREETING, useValue: 'hello' }, { provide: Greeter, deps: [] }],\n" +
    '  });\n' +
    "  expect(injector.get(Greeter).greeting).toBe('hello');\n" +
    '});\n';

  /** Installs `name` in the app's `node_modules`, with `manifest` merged into its package.json. */
  function install(name: string, manifest: object, source: string) {
    const dir = path.join(root, 'node_modules', name);
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
        ...manifest,
      }),
    );
    writeFileSync(path.join(dir, 'index.js'), source);
  }

  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-angular-library-')));
    mkdirSync(path.join(root, 'node_modules', '@angular'), { recursive: true });
    symlinkSync(
      realpathSync(path.join(import.meta.dirname, '..', 'node_modules', '@angular', 'core')),
      path.join(root, 'node_modules', '@angular', 'core'),
      'dir',
    );
    install('greeting-lib', { peerDependencies: { '@angular/core': '>=20' } }, helper);
    // One that imports `@angular/core` without saying so: only an app's own `inline` reaches it.
    install('undeclared-lib', {}, helper);
    // A service shipped partial-compiled, which runs only once the linker has been over it.
    install(
      'shout-lib',
      { dependencies: { '@angular/core': '>=20' } },
      "import * as i0 from '@angular/core';\n" +
        'export class Shout {\n' +
        "  text = 'HELLO';\n" +
        "  static ɵfac = i0.ɵɵngDeclareFactory({ minVersion: '12.0.0', version: '22.0.0', ngImport: i0, type: Shout, deps: [], target: i0.ɵɵFactoryTarget.Injectable });\n" +
        "  static ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: '12.0.0', version: '22.0.0', ngImport: i0, type: Shout, providedIn: 'root' });\n" +
        '}\n',
    );
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Runs `source` as a test file, with the app's own `server.deps.inline` if given, and returns
   * the errors it failed with, loading it included.
   */
  async function run(source: string, inline?: true | RegExp[]): Promise<string[]> {
    writeFileSync(path.join(root, 'library.test.ts'), source);
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest(
      'test',
      { root, config: false, watch: false, reporters: [], include: ['library.test.ts'] },
      {
        plugins: [ngNative()],
        ...(inline === undefined ? {} : { test: { server: { deps: { inline } } } }),
      },
    );
    try {
      await vitest.start();
      const files = vitest.state.getFiles();
      assert.equal(files.length, 1);
      const errors = files
        .flatMap((file) => [
          ...(file.result?.errors ?? []),
          ...file.tasks.flatMap((task) => task.result?.errors ?? []),
        ])
        .map((error) => error.message);
      // With no error, the test did run and pass.
      if (errors.length === 0) assert.equal(vitest.state.getCountOfFailedTests(), 0);
      if (errors.length === 0) assert.equal(files[0].tasks[0]?.result?.state, 'pass');
      return errors;
    } finally {
      await vitest.close();
      rmSync(path.join(root, 'library.test.ts'), { force: true });
    }
  }

  it("shares the test's @angular/core, so its inject() runs in the test's injection context", async () => {
    assert.deepEqual(await run(helperTest('greeting-lib')), []);
  });

  it('links a partial-compiled library that depends on @angular/core', async () => {
    const test =
      "import { Injector } from '@angular/core';\n" +
      "import { Shout } from 'shout-lib';\n" +
      "import { expect, it } from 'vitest';\n" +
      "it('injects the library service', () => {\n" +
      "  expect(Injector.create({ providers: [Shout] }).get(Shout).text).toBe('HELLO');\n" +
      '});\n';
    assert.deepEqual(await run(test), []);
  });

  it("keeps the app's own inline list beside the plugin's", async () => {
    assert.deepEqual(
      await run(helperTest('undeclared-lib'), [/\/node_modules\/undeclared-lib\//]),
      [],
    );
  });

  it('keeps inline: true, which inlines every package', async () => {
    assert.deepEqual(await run(helperTest('undeclared-lib'), true), []);
  });
});
