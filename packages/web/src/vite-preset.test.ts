/**
 * `@ng-native/web/vite` keeps React Native out of a browser build and leaves the `@ng-native/*`
 * packages to `@oxc-angular/vite`'s linker.
 *
 * `scripts/verify-publish.mjs --web` proves the whole path from the registry in a browser; this
 * pins the configuration it depends on, and runs Vite's own build and dependency pre-bundle over
 * `@ng-native/device`'s guard, installed as a package the way an app gets it.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build, optimizeDeps, resolveConfig, type Plugin, type UserConfig } from 'vite';
import { ngNativeWeb, ngNativeWebLink } from '../vite.mjs';

const config = () => {
  const found = ngNativeWeb().find((candidate) => candidate.name === 'ng-native:config');
  assert.ok(found, 'no ng-native:config plugin');
  return found;
};

it('leaves the packages in pre-bundling, where the linker reaches them', () => {
  // The linker skips every package named in `optimizeDeps.exclude`, so excluding one ships its
  // partial declarations unlinked, and the page fails with "JIT compiler unavailable".
  const settings = (config().config as () => UserConfig)();
  const exclude = settings.optimizeDeps?.exclude ?? [];
  assert.equal(
    exclude.some((name) => name.startsWith('@ng-native/')),
    false,
  );
});

it('sets no external, which a tool setting its own array has to merge with', () => {
  // Storybook sets `external` as an array; Vite concatenates ours onto it, and Rolldown refuses a
  // function in an array.
  const settings = (config().config as () => UserConfig)();
  assert.equal(settings.build?.rolldownOptions?.external, undefined);
});

it('resolves React Native and Expo to an empty module, and nothing else', () => {
  const resolve = config().resolveId as (id: string) => string | null;
  for (const id of ['react-native', 'react-native/Libraries/Image/resolveAssetSource', 'expo']) {
    assert.ok(resolve(id), id);
  }
  for (const id of ['expo-camera', 'react-native-svg', '@angular/core']) {
    assert.equal(resolve(id), null, id);
  }
});

/**
 * An app with `@ng-native/device`'s `react-native.ts` installed as a package, and React Native
 * reachable from it. Vite resolves `react-native` from the package's own folder, so a stand-in
 * that throws on evaluation proves it never reaches the page.
 */
describe("@ng-native/device's guard, through Vite", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-web-preset-')));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const guard = readFileSync(new URL('../../device/src/react-native.ts', import.meta.url), 'utf8');
  write(
    'node_modules/device/package.json',
    JSON.stringify({ name: 'device', type: 'module', main: 'index.js' }),
  );
  write('node_modules/device/index.js', stripTypeScriptTypes(guard));
  write(
    'node_modules/react-native/package.json',
    JSON.stringify({ name: 'react-native', main: 'index.js' }),
  );
  write('node_modules/react-native/index.js', "throw new Error('React Native in a browser');\n");
  write('main.js', "import { reactNative } from 'device';\nexport const found = reactNative();\n");

  after(() => rmSync(root, { recursive: true, force: true }));

  /** Imports a module Vite wrote, in Node, which has no `require` in an ES module either. */
  const evaluate = async (file: string): Promise<{ found?: unknown }> =>
    import(`${pathToFileURL(file).href}?${Date.now()}`);

  const shared = { root, configFile: false as const, logLevel: 'silent' as const };
  const plugins = (): Plugin[] => [config()];

  it('finds no React Native in a build', async () => {
    await build({
      ...shared,
      plugins: plugins(),
      build: {
        outDir: 'build',
        minify: false,
        lib: { entry: 'main.js', formats: ['es'], fileName: 'main' },
      },
    });
    assert.equal((await evaluate(path.join(root, 'build/main.mjs'))).found, null);
  });

  it("builds beside an external array of the app's own, as Storybook sets", async () => {
    await build({
      ...shared,
      plugins: plugins(),
      build: {
        outDir: 'storybook',
        lib: { entry: 'main.js', formats: ['es'], fileName: 'main' },
        rolldownOptions: { external: ['left-pad'] },
      },
    });
    assert.equal((await evaluate(path.join(root, 'storybook/main.mjs'))).found, null);
  });

  it('finds no React Native in the dependency pre-bundle', async () => {
    const resolved = await resolveConfig(
      { ...shared, plugins: plugins(), optimizeDeps: { include: ['device'] } },
      'serve',
    );
    await optimizeDeps(resolved, true);
    const bundled = path.join(resolved.cacheDir, 'deps/device.js');
    assert.doesNotMatch(readFileSync(bundled, 'utf8'), /from "react-native"/);
    const { reactNative } = (await evaluate(bundled)) as { reactNative(): unknown };
    assert.equal(reactNative(), null);
  });
});

/**
 * `ngNativeWebLink()`, for an app whose own Angular plugin compiles it, as Analog's does: a package
 * that ships `ngc` output in `dist/`, as the `@ng-native/*` packages do, built with nothing else.
 */
describe('ngNativeWebLink()', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-web-link-')));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write(
    'node_modules/library/package.json',
    JSON.stringify({ name: 'library', type: 'module', main: 'dist/index.js' }),
  );
  write(
    'node_modules/library/dist/index.js',
    [
      "import * as i0 from '@angular/core';",
      'export class Clock {}',
      'Clock.ɵprov = i0.ɵɵngDeclareInjectable({ minVersion: "12.0.0", version: "22.2.0", ' +
        'ngImport: i0, type: Clock, providedIn: "root" });',
    ].join('\n'),
  );
  write('main.js', "export { Clock } from 'library';\n");

  after(() => rmSync(root, { recursive: true, force: true }));

  it('is the resolution and the linker, without the compiler', () => {
    assert.deepEqual(
      ngNativeWebLink().map((plugin) => plugin.name),
      ['ng-native:config', '@oxc-angular/vite-linker'],
    );
  });

  it("links a package's partial declarations in dist/", async () => {
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: ngNativeWebLink(),
      build: {
        outDir: 'build',
        minify: false,
        lib: { entry: 'main.js', formats: ['es'], fileName: 'main' },
        rolldownOptions: { external: ['@angular/core'] },
      },
    });
    const built = readFileSync(path.join(root, 'build/main.mjs'), 'utf8');
    assert.doesNotMatch(built, /ɵɵngDeclareInjectable/);
    assert.match(built, /ɵɵdefineInjectable/);
  });
});

/**
 * `ngNativeWeb()` twice, as Storybook's recipe gets it: the app's `vite.config.ts` has it, and
 * `viteFinal` adds it again. A second compiler would compile its component a second time, and
 * finds `input()` in a class whose decorator the first one already took off.
 */
describe('ngNativeWeb() registered twice', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-web-twice-')));
  writeFileSync(
    path.join(root, 'main.ts'),
    [
      "import { Component, input } from '@angular/core';",
      "@Component({ selector: 'app-label', template: '{{ label() }}' })",
      "export class Label { readonly label = input('Label'); }",
    ].join('\n'),
  );

  after(() => rmSync(root, { recursive: true, force: true }));

  const built = async (plugins: UserConfig['plugins'], outDir: string) => {
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins,
      build: {
        outDir,
        minify: false,
        lib: { entry: 'main.ts', formats: ['es'], fileName: 'main' },
        rolldownOptions: { external: [/^@angular\//] },
      },
    });
    return readFileSync(path.join(root, outDir, 'main.mjs'), 'utf8');
  };

  it('compiles a component once', async () => {
    const code = await built([ngNativeWeb(), ngNativeWeb()], 'twice');
    assert.equal(code.match(/ɵɵdefineComponent\(/g)?.length, 1);
  });

  it("keeps a plugin's own apply: the optimizer only builds", async () => {
    const names = async (command: 'serve' | 'build') =>
      (
        await resolveConfig(
          { root, configFile: false, logLevel: 'silent', plugins: [ngNativeWeb(), ngNativeWeb()] },
          command,
        )
      ).plugins
        .map((plugin) => plugin.name)
        .filter((name) => name === '@oxc-angular/vite-optimizer');
    assert.deepEqual(await names('serve'), []);
    assert.deepEqual(await names('build'), ['@oxc-angular/vite-optimizer']);
  });

  it("keeps the compiler beside ngNativeWebLink()'s plugins", async () => {
    const code = await built([ngNativeWebLink(), ngNativeWeb()], 'linked');
    assert.equal(code.match(/ɵɵdefineComponent\(/g)?.length, 1);
  });
});
