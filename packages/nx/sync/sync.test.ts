/**
 * `@ng-native/nx:sync-native-modules`: the native modules an app's libraries import, listed in the
 * app's `package.json`, where Expo's autolinking looks, with their config plugins in `app.json`.
 *
 * The project graph and the installed packages are replaced by fakes: the graph is what Nx 23.2
 * records for a library that imports a package, and each package is described as it is installed.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { addProjectConfiguration, readJson, readProjectConfiguration, updateJson, writeJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
const {
  syncNativeModules,
  registerSyncGenerator,
  workspace,
  SYNC_GENERATOR,
} = require('./index.cjs');

type Installed = {
  version: string;
  native: boolean;
  plugin: boolean;
  peers: string[];
  dir: string;
};
const original = { ...workspace };
afterEach(() => Object.assign(workspace, original));

/** Packages as installed: expo-haptics and expo-font are Expo modules, expo-font with a plugin. */
const packages: Record<string, Partial<Installed>> = {
  'expo-haptics': { version: '57.0.3', native: true },
  'expo-font': { version: '57.0.4', native: true, plugin: true },
  'expo-location': { version: '57.0.2', native: true, plugin: true },
  '@expo-google-fonts/inter': { version: '0.4.2' },
  '@ng-native/icons': { version: '0.2.0', peers: ['@angular/core', 'react-native-svg'] },
  'react-native-svg': { version: '15.15.1', native: true },
  '@angular/core': { version: '22.1.4' },
};

/**
 * An app, `mobile`, using the library `ui`, which uses `tokens`. `imports` lists what each library
 * imports, as the project graph records it.
 */
function setUp(imports: Record<string, string[]>, rootDependencies: Record<string, string> = {}) {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@ng-native/platform': '0.2.0', ...rootDependencies },
  }));
  addProjectConfiguration(tree, 'mobile', { root: 'apps/mobile', projectType: 'application' });
  writeJson(tree, 'apps/mobile/package.json', {
    name: 'mobile',
    dependencies: { '@ng-native/platform': '0.2.0', expo: '~57.0.26' },
  });
  writeJson(tree, 'apps/mobile/app.json', {
    expo: { name: 'mobile', platforms: ['ios', 'android'] },
  });
  addProjectConfiguration(tree, 'ui', { root: 'packages/ui', projectType: 'library' });
  addProjectConfiguration(tree, 'tokens', { root: 'packages/tokens', projectType: 'library' });

  const node = (name: string, root: string) => ({ name, type: 'lib', data: { root } });
  const npm = (pkg: string) => ({ source: '', target: `npm:${pkg}`, type: 'static' });
  const external = Object.fromEntries(
    Object.values(imports)
      .flat()
      .map((pkg) => [
        `npm:${pkg}`,
        { name: `npm:${pkg}`, type: 'npm', data: { packageName: pkg } },
      ]),
  );
  const graph = {
    nodes: {
      mobile: { name: 'mobile', type: 'app', data: { root: 'apps/mobile' } },
      ui: node('ui', 'packages/ui'),
      tokens: node('tokens', 'packages/tokens'),
    },
    externalNodes: external,
    dependencies: {
      mobile: [{ source: 'mobile', target: 'ui', type: 'static' }, npm('expo')],
      ui: [{ source: 'ui', target: 'tokens', type: 'static' }, ...(imports.ui ?? []).map(npm)],
      tokens: (imports.tokens ?? []).map(npm),
    },
  };
  workspace.graph = async () => graph;
  workspace.installed = (pkg: string): Installed | undefined =>
    packages[pkg]
      ? ({
          native: false,
          plugin: false,
          peers: [],
          dir: `/node_modules/${pkg}`,
          ...packages[pkg],
        } as Installed)
      : undefined;
  workspace.autoPlugins = () => ['expo-location'];
  return tree;
}

const appDependencies = (tree: Tree) => readJson(tree, 'apps/mobile/package.json').dependencies;
const appPlugins = (tree: Tree) => readJson(tree, 'apps/mobile/app.json').expo.plugins;

describe('sync-native-modules', () => {
  it("lists a native module a library imports in the app's package.json, at the root's range", async () => {
    const tree = setUp({ ui: ['expo-haptics'] }, { 'expo-haptics': '~57.0.3' });
    const result = await syncNativeModules(tree);
    assert.equal(appDependencies(tree)['expo-haptics'], '~57.0.3');
    assert.match(result.outOfSyncMessage ?? '', /development build would not link it/);
    assert.deepEqual(result.outOfSyncDetails, [
      'apps/mobile/package.json needs expo-haptics: packages/ui imports it.',
    ]);
  });

  it('finds one a library imports through another library', async () => {
    const tree = setUp({ tokens: ['expo-haptics'] }, { 'expo-haptics': '~57.0.3' });
    await syncNativeModules(tree);
    assert.equal(appDependencies(tree)['expo-haptics'], '~57.0.3');
  });

  it("takes the library's own range in a workspace package, and the installed version otherwise", async () => {
    const tree = setUp({ ui: ['expo-haptics', 'react-native-svg'] });
    writeJson(tree, 'packages/ui/package.json', {
      name: '@org/ui',
      dependencies: { 'expo-haptics': '~57.0.1' },
    });
    await syncNativeModules(tree);
    assert.equal(appDependencies(tree)['expo-haptics'], '~57.0.1');
    assert.equal(appDependencies(tree)['react-native-svg'], '15.15.1');
  });

  it('leaves out a package with no native code', async () => {
    const tree = setUp({ ui: ['@expo-google-fonts/inter', '@angular/core'] });
    assert.deepEqual(await syncNativeModules(tree), {});
    assert.deepEqual(Object.keys(appDependencies(tree)), ['@ng-native/platform', 'expo']);
  });

  it('adds a native module that an imported package peers on, as @ng-native/icons does on react-native-svg', async () => {
    const tree = setUp({ ui: ['@ng-native/icons'] }, { 'react-native-svg': '15.15.1' });
    const result = await syncNativeModules(tree);
    assert.equal(appDependencies(tree)['react-native-svg'], '15.15.1');
    assert.equal(appDependencies(tree)['@ng-native/icons'], undefined);
    assert.deepEqual(result.outOfSyncDetails, [
      'apps/mobile/package.json needs react-native-svg: packages/ui imports @ng-native/icons, which needs it.',
    ]);
  });

  it("adds a config plugin to the app's app.json, but not one Expo applies itself", async () => {
    const tree = setUp({ ui: ['expo-font', 'expo-location'] });
    await syncNativeModules(tree);
    assert.deepEqual(appPlugins(tree), ['expo-font']);
  });

  it('keeps the plugins and dependencies the app has, and changes nothing when it is in sync', async () => {
    const tree = setUp({ ui: ['expo-font'] });
    updateJson(tree, 'apps/mobile/app.json', (config) => {
      config.expo.plugins = [['expo-font', { fonts: [] }]];
      return config;
    });
    updateJson(tree, 'apps/mobile/package.json', (manifest) => {
      manifest.dependencies['expo-font'] = '~57.0.0';
      return manifest;
    });
    assert.deepEqual(await syncNativeModules(tree), {});
    assert.equal(appDependencies(tree)['expo-font'], '~57.0.0');
    assert.deepEqual(appPlugins(tree), [['expo-font', { fonts: [] }]]);
  });

  it('leaves alone a project that is not an Angular Native app', async () => {
    const tree = setUp({ ui: ['expo-haptics'] });
    updateJson(tree, 'apps/mobile/package.json', (manifest) => {
      delete manifest.dependencies['@ng-native/platform'];
      return manifest;
    });
    assert.deepEqual(await syncNativeModules(tree), {});
    assert.equal(appDependencies(tree)['expo-haptics'], undefined);
  });
});

describe('what counts as a native module', () => {
  function install(files: Record<string, string>) {
    const root = mkdtempSync(path.join(tmpdir(), 'ngn-sync-'));
    const dir = path.join(root, 'node_modules/some-module');
    for (const [file, content] of Object.entries({
      'package.json': JSON.stringify({
        name: 'some-module',
        version: '1.2.3',
        peerDependencies: { 'react-native': '*', 'react-native-svg': '*' },
        peerDependenciesMeta: { 'react-native': { optional: true } },
      }),
      ...files,
    })) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    return root;
  }

  for (const [kind, files] of [
    ['an Expo module', { 'expo-module.config.json': '{}' }],
    ['a package with a podspec', { 'RNSome.podspec': '' }],
    ['a package with an Android project', { 'android/build.gradle': '' }],
  ] as const) {
    it(`is ${kind}`, () => {
      const root = install(files);
      try {
        assert.equal(workspace.installed('some-module', root)?.native, true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('is not a package of JavaScript alone, and reads its plugin and required peers', () => {
    const root = install({ 'app.plugin.js': 'module.exports = (config) => config;' });
    try {
      const installed = workspace.installed('some-module', root);
      assert.equal(installed?.native, false);
      assert.equal(installed?.plugin, true);
      assert.equal(installed?.version, '1.2.3');
      assert.deepEqual(installed?.peers, ['react-native-svg']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is nothing when it is not installed', () => {
    assert.equal(workspace.installed('not-installed-anywhere', tmpdir()), undefined);
  });
});

describe('registerSyncGenerator', () => {
  it("runs it before the app's start, export and prebuild, keeping what they have", () => {
    const tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'mobile', {
      root: 'apps/mobile',
      targets: { start: { executor: 'nx:run-commands', options: { command: 'expo start' } } },
    });
    registerSyncGenerator(tree, 'mobile');
    registerSyncGenerator(tree, 'mobile');
    const { targets } = readProjectConfiguration(tree, 'mobile');
    assert.deepEqual(targets?.start, {
      executor: 'nx:run-commands',
      options: { command: 'expo start' },
      syncGenerators: [SYNC_GENERATOR],
    });
    assert.deepEqual(targets?.export, { syncGenerators: [SYNC_GENERATOR] });
    assert.deepEqual(targets?.prebuild, { syncGenerators: [SYNC_GENERATOR] });
  });
});
