/**
 * `nx g @ng-native/nx:nativescript <app>`: a generated app, set up for `@ng-native/nativescript`.
 *
 * Each piece left out fails somewhere else: without the config plugin the build has no runtime and
 * `provideNativeScript` throws on the device, without the types every native class is an error in
 * the typecheck, and without the provider nothing installs.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { logger, readJson, updateJson } = require('@nx/devkit') as typeof import('@nx/devkit');
const { application } = require('../application/index.cjs');
const { nativescript } = require('./index.cjs');
const { registry } = require('../save-exact.cjs') as {
  registry: { versions: (name: string, cwd: string) => Promise<string[]> };
};

registry.versions = async () => {
  throw new Error('offline');
};

async function app() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@angular/core': '~22.2.0' },
    devDependencies: { nx: '23.2.0' },
  }));
  await application(tree, { directory: 'apps/mobile', skipFormat: true, skipInstall: true });
  return tree;
}

const run = (tree: Tree) =>
  nativescript(tree, { project: 'mobile', skipFormat: true, skipInstall: true });

describe('the nativescript generator', () => {
  it('adds the packages, the config plugin, the types and the provider', async () => {
    const tree = await app();
    await run(tree);

    const { dependencies } = readJson(tree, 'package.json');
    assert.ok(dependencies['@ng-native/nativescript']);
    assert.equal(dependencies['@nativescript/react-native'], '^9.1.2');
    assert.ok(dependencies['react-native-worklets']);

    assert.ok(
      readJson(tree, 'apps/mobile/app.json').expo.plugins.includes('@ng-native/nativescript'),
    );
    const types = tree.read('apps/mobile/src/nativescript.d.ts', 'utf-8')!;
    assert.match(types, /types="@nativescript\/react-native\/types\/ios"/);
    assert.match(types, /types="@nativescript\/types-android"/);
    assert.ok(readJson(tree, 'package.json').devDependencies['@nativescript/types-android']);

    const main = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    assert.match(main, /^import \{ provideNativeScript \} from '@ng-native\/nativescript';$/m);
    assert.match(main, /mount\([^\n]*\{\n\s*providers: \[provideNativeScript\(\)\],/);
  });

  it('adds to providers the app already passes', async () => {
    const tree = await app();
    const main = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    tree.write(
      'apps/mobile/src/main.ts',
      main.replace('processColor,\n', 'processColor,\n    providers: [provideRouter([])],\n'),
    );
    await run(tree);
    assert.match(
      tree.read('apps/mobile/src/main.ts', 'utf-8')!,
      /providers: \[provideNativeScript\(\), provideRouter\(\[\]\)\]/,
    );
  });

  it('leaves providers it cannot add to alone, and says what to add', async () => {
    // Adding a second providers key would drop the app's own: the last key wins.
    const tree = await app();
    const main = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    const named = main.replace('processColor,\n', 'processColor,\n    providers: appProviders,\n');
    tree.write('apps/mobile/src/main.ts', named);
    const warnings: string[] = [];
    const warn = logger.warn;
    logger.warn = (message: string) => warnings.push(message);
    try {
      await run(tree);
    } finally {
      logger.warn = warn;
    }
    assert.equal(tree.read('apps/mobile/src/main.ts', 'utf-8'), named);
    assert.match(warnings.join('\n'), /add provideNativeScript\(\) to the providers/);
  });

  it("adds the worklets Expo's SDK bundles: 0.13.0 on 58, 0.10.1 on 57", async () => {
    const tree = await app();
    await run(tree);
    assert.equal(readJson(tree, 'package.json').dependencies['react-native-worklets'], '0.13.0');

    const older = await app();
    updateJson(older, 'package.json', (manifest) => {
      manifest.dependencies.expo = '~57.0.26';
      return manifest;
    });
    await run(older);
    assert.equal(readJson(older, 'package.json').dependencies['react-native-worklets'], '0.10.1');
  });

  it('leaves a providers list outside mount alone', async () => {
    const tree = await app();
    const main = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    tree.write('apps/mobile/src/main.ts', `const config = { providers: [] };\n${main}`);
    await run(tree);
    const updated = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    assert.match(updated, /^const config = \{ providers: \[\] \};$/m);
    assert.match(updated, /mount\([^\n]*\{\n\s*providers: \[provideNativeScript\(\)\],/);
  });

  it('imports provideNativeScript only once', async () => {
    const tree = await app();
    const main = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    tree.write(
      'apps/mobile/src/main.ts',
      `import { provideNativeScript } from '@ng-native/nativescript';\n${main}`,
    );
    await run(tree);
    const updated = tree.read('apps/mobile/src/main.ts', 'utf-8')!;
    assert.equal(updated.match(/import \{ provideNativeScript \}/g)!.length, 1);
    assert.match(updated, /providers: \[provideNativeScript\(\)\]/);
  });

  it('changes nothing run again', async () => {
    const tree = await app();
    await run(tree);
    const files = ['apps/mobile/src/main.ts', 'apps/mobile/app.json', 'package.json'];
    const before = files.map((file) => tree.read(file, 'utf-8'));
    await run(tree);
    assert.deepEqual(
      files.map((file) => tree.read(file, 'utf-8')),
      before,
    );
  });
});
