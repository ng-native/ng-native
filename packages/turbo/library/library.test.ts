import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { workspace } from '../test-workspace.ts';

const require = createRequire(import.meta.url);
const { library } = require('./index.cjs');
const native = require('../native-app.cjs');
const { componentSource, testSource } = require('../component/sources.cjs');

describe('ng-native-library', () => {
  it('exports its source, with a native component and its test, and no build', async () => {
    const files = workspace();
    await library(files, { directory: 'packages/native-ui' });
    const manifest = files.readJson('packages/native-ui/package.json');
    assert.equal(manifest.name, '@repo/native-ui');
    assert.equal(manifest.type, 'module');
    assert.deepEqual(manifest.exports, { '.': './src/index.ts' });
    assert.deepEqual(manifest.scripts, { typecheck: 'ngc -p tsconfig.json', test: 'vitest run' });
    assert.equal(
      files.read('packages/native-ui/src/index.ts'),
      "export { NativeUi } from './lib/native-ui.ts';\n",
    );
    assert.equal(
      files.read('packages/native-ui/src/lib/native-ui.ts'),
      componentSource('NativeUi', 'repo-native-ui', 'native-ui works'),
    );
    assert.equal(
      files.read('packages/native-ui/src/lib/native-ui.test.ts'),
      testSource('NativeUi', 'native-ui', 'native-ui works'),
    );
    assert.equal(files.read('packages/native-ui/vitest.config.mts'), native.LIBRARY_VITEST_CONFIG);
  });

  // `@ng-native/migrate` moves the versions a manifest installs and leaves peer ranges alone, so
  // the components' peer range is open above: an exact one would stop matching after an update.
  it("peers on the app's Angular and components, and tests and typechecks with the app's", async () => {
    const files = workspace();
    await library(files, { directory: 'packages/native-ui' });
    const { peerDependencies, devDependencies } = files.readJson('packages/native-ui/package.json');
    assert.deepEqual(peerDependencies, {
      '@angular/core': native.dependencies['@angular/core'],
      '@ng-native/components': `>=${native.dependencies['@ng-native/components']}`,
    });
    for (const name of Object.keys(peerDependencies)) {
      assert.equal(devDependencies[name], native.dependencies[name], name);
    }
    for (const name of [
      '@angular/compiler-cli',
      '@babel/core',
      '@ng-native/testing',
      'typescript',
      'vitest',
    ]) {
      assert.equal(devDependencies[name], native.devDependencies[name], name);
    }
  });

  it("checks templates as an app does, and imports with .ts as the template's tests do", async () => {
    const files = workspace();
    await library(files, { directory: 'packages/native-ui' });
    const tsconfig = files.readJson('packages/native-ui/tsconfig.json');
    const app = JSON.parse(native.sourceFile('tsconfig.json'));
    assert.deepEqual(tsconfig.angularCompilerOptions, app.angularCompilerOptions);
    assert.equal(tsconfig.compilerOptions.allowImportingTsExtensions, true);
    assert.equal(tsconfig.compilerOptions.noEmit, true);
    assert.deepEqual(tsconfig.compilerOptions.lib, ['DOM', 'ESNext']);
  });

  it('names an unscoped library, and its selectors, by its directory alone', async () => {
    const files = workspace({
      'package.json': JSON.stringify({ name: 'root' }),
      'packages/ui/package.json': null,
    });
    await library(files, { directory: 'packages/design-kit' });
    assert.equal(files.readJson('packages/design-kit/package.json').name, 'design-kit');
    assert.match(
      files.read('packages/design-kit/src/lib/design-kit.ts')!,
      /selector: 'design-kit'/,
    );
    assert.match(files.read('packages/design-kit/src/index.ts')!, /export \{ DesignKit \}/);
  });

  it('adds its directory to the workspace, and refuses one that has a package', async () => {
    const files = workspace({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n" });
    await library(files, { directory: 'libs/ui' });
    assert.match(files.read('pnpm-workspace.yaml')!, /- 'libs\/\*'/);
    await assert.rejects(library(files, { directory: 'libs/ui' }), /already has a package\.json/);
  });

  it('says how an app takes it, with the protocol the package manager links by', async () => {
    assert.match(await library(workspace(), { directory: 'packages/native-ui' }), /"workspace:\*"/);
    const npm = workspace({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      'pnpm-workspace.yaml': null,
      'package-lock.json': '{}',
      'packages/ui/package.json': null,
    });
    assert.match(await library(npm, { directory: 'packages/native-ui' }), /"native-ui": "\*"/);
  });

  it('refuses a directory npm cannot name a package after, before writing anything', async () => {
    const files = workspace({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n" });
    const before = files.read('pnpm-workspace.yaml');
    await assert.rejects(library(files, { directory: 'libs/My UI' }), /cannot name a package/);
    await assert.rejects(
      library(files, { directory: 'libs/view' }),
      /is a name the component imports/,
    );
    assert.equal(files.read('pnpm-workspace.yaml'), before);
    assert.equal(files.exists('libs'), false);
  });
});
