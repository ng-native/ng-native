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
import { ngNativeWeb } from '../vite.mjs';

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
