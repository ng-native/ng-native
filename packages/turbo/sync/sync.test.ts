import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { workspace } from '../test-workspace.ts';

const require = createRequire(import.meta.url);
const { sync, installed } = require('./index.cjs');

type Info = { version: string; native: boolean; plugin: boolean; peers: string[]; dir: string };

/** What is installed, by name: never the real packages, which a test cannot choose. */
const packages: Record<string, Partial<Info>> = {
  'expo-camera': { version: '58.0.3', native: true, plugin: true },
  'expo-haptics': { version: '58.0.1', native: true, plugin: false },
  'expo-font': { version: '58.0.2', native: true, plugin: true },
  '@ng-native/icons': { version: '0.25.0', native: false, peers: ['react-native-svg'] },
  'chart-kit': { version: '1.0.0', native: false, peers: ['@ng-native/icons'] },
  'react-native-svg': { version: '15.16.0', native: true, plugin: false },
  'date-fns': { version: '4.1.0', native: false },
};
installed.find = (pkg: string) =>
  packages[pkg] && { plugin: false, peers: [], dir: `/installed/${pkg}`, ...packages[pkg] };
installed.autoPlugins = () => ['expo-font'];

const app = (dependencies: Record<string, string>, plugins: unknown[] = ['@ng-native/metro']) => ({
  'apps/mobile/package.json': JSON.stringify({
    name: '@acme/mobile',
    dependencies: { '@ng-native/platform': '0.25.0', ...dependencies },
  }),
  'apps/mobile/app.json': JSON.stringify({ expo: { plugins } }),
});

const lib = (name: string, manifest: object) => ({
  [`packages/${name}/package.json`]: JSON.stringify({ name: `@acme/${name}`, ...manifest }),
});

describe('ng-native-sync', () => {
  it("lists a native module a library uses in the app, at the library's range", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { dependencies: { 'expo-haptics': '~58.0.0', 'date-fns': '^4.0.0' } }),
    });
    const { changes } = await sync(files);
    assert.deepEqual(changes, [
      'apps/mobile/package.json needs expo-haptics: packages/ui uses it.',
    ]);
    const { dependencies } = files.readJson('apps/mobile/package.json');
    assert.equal(dependencies['expo-haptics'], '~58.0.0');
    assert.equal(dependencies['date-fns'], undefined);
  });

  it("never takes a library's peer range, which says what it accepts, not what to install", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*', '@acme/kit': 'workspace:*' }),
      ...lib('ui', {
        peerDependencies: { 'expo-haptics': '*' },
        devDependencies: { 'expo-haptics': '~58.0.0' },
      }),
      ...lib('kit', { peerDependencies: { 'expo-camera': '*' } }),
    });
    await sync(files);
    const { dependencies } = files.readJson('apps/mobile/package.json');
    assert.equal(dependencies['expo-haptics'], '~58.0.0');
    // With no range of the library's own, the version installed.
    assert.equal(dependencies['expo-camera'], '58.0.3');
  });

  it("takes the range of a library's optional dependency, not the version installed", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { optionalDependencies: { 'expo-haptics': '~58.0.0' } }),
    });
    await sync(files);
    assert.equal(
      files.readJson('apps/mobile/package.json').dependencies['expo-haptics'],
      '~58.0.0',
    );
  });

  it("rewrites a library's or the root's relative file: range from the app's directory", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*', '@acme/kit': 'workspace:*' }),
      ...lib('ui', { dependencies: { 'expo-haptics': 'file:../vendor/expo-haptics' } }),
      ...lib('kit', { dependencies: { 'expo-camera': 'link:/opt/expo-camera' } }),
      'package.json': JSON.stringify({
        name: 'my-turborepo',
        devDependencies: { 'react-native-svg': 'file:vendor/svg.tgz' },
      }),
    });
    files.updateJson('packages/kit/package.json', (manifest: Record<string, any>) => ({
      ...manifest,
      dependencies: { ...manifest.dependencies, 'react-native-svg': '^15.0.0' },
    }));
    await sync(files);
    const { dependencies } = files.readJson('apps/mobile/package.json');
    assert.equal(dependencies['expo-haptics'], 'file:../../packages/vendor/expo-haptics');
    assert.equal(dependencies['react-native-svg'], 'file:../../vendor/svg.tgz');
    // An absolute path names the same directory from anywhere.
    assert.equal(dependencies['expo-camera'], 'link:/opt/expo-camera');
  });

  it("follows a library's dependencies on another library, not its dev dependencies", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { devDependencies: { '@acme/fixtures': 'workspace:*' } }),
      ...lib('fixtures', { dependencies: { 'expo-camera': '~58.0.0' } }),
    });
    assert.deepEqual((await sync(files)).changes, []);
  });

  it("takes the root's range where the root lists the module", async () => {
    const files = workspace({
      'package.json': JSON.stringify({
        name: '@acme/root',
        dependencies: { 'expo-haptics': '58.0.1' },
      }),
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { peerDependencies: { 'expo-haptics': '*' } }),
    });
    await sync(files);
    assert.equal(files.readJson('apps/mobile/package.json').dependencies['expo-haptics'], '58.0.1');
  });

  it('follows a library through another, and a package that peers on a native module', async () => {
    const files = workspace({
      ...app({ '@acme/feature': 'workspace:*' }),
      ...lib('feature', { dependencies: { '@acme/ui': 'workspace:*' } }),
      ...lib('ui', { dependencies: { '@ng-native/icons': '0.25.0' } }),
    });
    const { changes } = await sync(files);
    assert.deepEqual(changes, [
      'apps/mobile/package.json needs react-native-svg: packages/ui uses @ng-native/icons, which needs it.',
    ]);
  });

  it("follows required peers at any depth, and a library's optional dependencies", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', {
        dependencies: { 'chart-kit': '^1.0.0' },
        optionalDependencies: { 'expo-haptics': '~58.0.0' },
      }),
    });
    const { changes } = await sync(files);
    assert.deepEqual(changes.sort(), [
      'apps/mobile/package.json needs expo-haptics: packages/ui uses it.',
      'apps/mobile/package.json needs react-native-svg: packages/ui uses chart-kit, which needs it.',
    ]);
  });

  it('finds a library at any depth a ** glob reaches', async () => {
    const files = workspace({
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/**'\n",
      ...app({ '@acme/ui': 'workspace:*' }),
      'packages/domain/feature/native/ui/package.json': JSON.stringify({
        name: '@acme/ui',
        dependencies: { 'expo-haptics': '~58.0.0' },
      }),
    });
    assert.equal((await sync(files)).changes.length, 1);
  });

  it("adds a module's config plugin to app.json, but not one Expo applies itself", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }, ['@ng-native/metro', ['expo-haptics', {}]]),
      ...lib('ui', { dependencies: { 'expo-camera': '~58.0.0', 'expo-font': '~58.0.0' } }),
    });
    await sync(files);
    assert.deepEqual(files.readJson('apps/mobile/app.json').expo.plugins, [
      '@ng-native/metro',
      ['expo-haptics', {}],
      'expo-camera',
    ]);
  });

  it("follows neither a library's dev dependencies nor a package that is not an app", async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { devDependencies: { 'expo-haptics': '~58.0.0' } }),
      ...lib('other', { dependencies: { 'expo-camera': '~58.0.0' } }),
    });
    assert.deepEqual((await sync(files)).changes, []);
  });

  it('changes nothing when the app is in sync, or when only checking', async () => {
    const files = workspace({
      ...app({ '@acme/ui': 'workspace:*' }),
      ...lib('ui', { dependencies: { 'expo-camera': '~58.0.0' } }),
    });
    const before = files.read('apps/mobile/package.json');
    const { changes } = await sync(files, { check: true });
    assert.equal(changes.length, 2);
    assert.equal(files.read('apps/mobile/package.json'), before);

    await sync(files);
    const synced = [files.read('apps/mobile/package.json'), files.read('apps/mobile/app.json')];
    assert.deepEqual((await sync(files)).changes, []);
    assert.deepEqual(
      [files.read('apps/mobile/package.json'), files.read('apps/mobile/app.json')],
      synced,
    );
  });

  it('resolves each module from the library that uses it', async () => {
    const from: string[] = [];
    const find = installed.find;
    installed.find = (pkg: string, dir: string) => (from.push(dir), find(pkg));
    try {
      const files = workspace({
        ...app({ '@acme/ui': 'workspace:*' }),
        ...lib('ui', { dependencies: { 'expo-haptics': '~58.0.0' } }),
      });
      await sync(files);
      assert.deepEqual(from, [path.join(files.root, 'packages/ui')]);
    } finally {
      installed.find = find;
    }
  });
});
