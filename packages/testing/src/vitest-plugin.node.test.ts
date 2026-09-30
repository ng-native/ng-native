/**
 * The Vitest plugin hides CommonJS `require` from the modules it transforms, on every Vitest.
 *
 * Code here probes `typeof require` to tell a device from Node: given one, it requires
 * `react-native` or an Expo module, whose Flow source nothing in a test can parse. Vitest 5 has
 * `injectCjsGlobals: false` to leave it out; Vitest 4 has no such option and always passes one
 * in, so a routing test failed with "Unexpected token 'typeof'". The plugin now shadows it itself.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import { ngNative } from '../runner/vitest.mjs';

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
  const resolve = async (source: string, importer = libraryFile) =>
    (await server.environments.ssr!.pluginContainer.resolveId(source, importer))?.id;

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
    // A workspace package the app links from its source folder: its real path has no
    // node_modules in it.
    const linked = path.join(ws, 'packages/linked');
    mkdirSync(linked, { recursive: true });
    writeFileSync(
      path.join(linked, 'package.json'),
      JSON.stringify({ name: '@scope/linked', version: '1.0.0', main: 'index.js' }),
    );
    writeFileSync(path.join(linked, 'index.js'), '');
    symlinkSync(linked, path.join(app, 'node_modules/@scope/linked'));
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
});
