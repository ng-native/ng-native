/**
 * `nx g @ng-native/nx:mobile <app>`: a desktop-only app, set up to run on iOS and Android too.
 *
 * It undoes what `--desktopOnly` left out: without `ios` and `android` in `expo.platforms` Metro
 * does not bundle for them, without the Android package `expo prebuild` stops to ask for one,
 * without `expo-status-bar` and `expo-system-ui` the app has a desktop app's dependencies, and while
 * `nx.json` keeps `@nx/expo`'s plugin off the app nothing infers `run-ios` or `run-android`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { addProjectConfiguration, readJson, readNxJson, readProjectConfiguration, updateJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
// Nx's own reading of a plugin's include and exclude, negations and order included.
const { findMatchingConfigFiles } =
  require('nx/src/project-graph/utils/project-configuration-utils.js') as {
    findMatchingConfigFiles: (files: string[], include?: string[], exclude?: string[]) => string[];
  };
const { application } = require('../application/index.cjs');
const { mobile } = require('./index.cjs');
const native = require('../native-app.cjs');
const { registry } = require('../save-exact.cjs') as {
  registry: { versions: (name: string, cwd: string) => Promise<string[]> };
};

registry.versions = async () => {
  throw new Error('offline');
};

/** An integrated workspace, one root `package.json`, with a mobile app and a desktop-only one. */
async function integrated(plugins?: unknown[]) {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@angular/core': '~22.2.0' },
    devDependencies: { nx: '23.2.0' },
  }));
  if (plugins) updateJson(tree, 'nx.json', (nxJson) => ({ ...nxJson, plugins }));
  const options = { skipFormat: true, skipInstall: true };
  await application(tree, { directory: 'apps/mobile', ...options });
  await application(tree, { directory: 'apps/desktop', desktopOnly: true, ...options });
  return tree;
}

/** A workspace with pnpm workspaces, where the app lists its own dependencies. */
async function pnpmWorkspace() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    devDependencies: { nx: '23.2.0' },
  }));
  tree.delete('tsconfig.base.json');
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
  await application(tree, {
    directory: 'apps/desktop',
    desktopOnly: true,
    skipFormat: true,
    skipInstall: true,
  });
  return tree;
}

const run = (tree: Tree, project = 'desktop') =>
  mobile(tree, { project, skipFormat: true, skipInstall: true });

/** Whether Nx runs `@nx/expo`'s plugin on `file`, by each registration's include and exclude. */
const inferredBy = (tree: Tree, file: string) =>
  (readNxJson(tree)?.plugins ?? [])
    .map((entry) => (typeof entry === 'string' ? { plugin: entry } : entry))
    .filter((entry) => entry.plugin === '@nx/expo/plugin')
    .some((entry) => findMatchingConfigFiles([file], entry.include, entry.exclude).length === 1);

describe('the mobile generator', () => {
  it("writes the phone settings a mobile app's app.json has, keeping macOS", async () => {
    const tree = await integrated();
    await run(tree);
    const { expo } = readJson(tree, 'apps/desktop/app.json');
    const bundle = expo.ios.bundleIdentifier;
    // What an app generated for iOS and Android, then given macOS, has.
    const expected = JSON.parse(native.appJson('desktop', bundle, ['ios', 'android', 'macos']));
    assert.deepEqual(expo, expected.expo);
    assert.deepEqual(expo.platforms, ['ios', 'android', 'macos']);
    assert.equal(expo.android.package, bundle);
  });

  it('keeps a phone setting the app already has', async () => {
    const tree = await integrated();
    updateJson(tree, 'apps/desktop/app.json', ({ expo }) => ({
      expo: {
        ...expo,
        orientation: 'default',
        android: { package: 'com.acme.droid' },
        ios: { ...expo.ios, supportsTablet: false },
      },
    }));
    await run(tree);
    const { expo } = readJson(tree, 'apps/desktop/app.json');
    assert.equal(expo.orientation, 'default');
    assert.equal(expo.ios.supportsTablet, false);
    assert.deepEqual(expo.android, {
      package: 'com.acme.droid',
      predictiveBackGestureEnabled: false,
    });
  });

  it("adds the phone's status bar and system UI packages where the app's dependencies go", async () => {
    const tree = await integrated();
    await run(tree);
    const root = readJson(tree, 'package.json').dependencies;
    // Expo autolinks only the native modules the app's own package.json names.
    const pins = readJson(tree, 'apps/desktop/package.json').dependencies;
    for (const name of ['expo-status-bar', 'expo-system-ui']) {
      assert.equal(root[name], native.dependencies[name], name);
      assert.equal(pins[name], native.dependencies[name], name);
    }
    assert.deepEqual(Object.keys(native.mobileDependencies), ['expo-status-bar', 'expo-system-ui']);

    const linked = await pnpmWorkspace();
    await run(linked, '@proj/desktop');
    const own = readJson(linked, 'apps/desktop/package.json').dependencies;
    for (const name of Object.keys(native.dependencies)) assert.ok(own[name], name);
    assert.equal(readJson(linked, 'package.json').dependencies?.['expo-status-bar'], undefined);
  });

  for (const [shape, plugins] of [
    ['as a string', ['@nx/expo/plugin']],
    ['as an object', [{ plugin: '@nx/expo/plugin', options: { runIosTargetName: 'run-ios' } }]],
  ] as const) {
    it(`lets @nx/expo's plugin, registered ${shape}, infer run-ios and run-android again`, async () => {
      const tree = await integrated([...plugins]);
      assert.equal(inferredBy(tree, 'apps/desktop/app.json'), false);
      await run(tree);
      assert.equal(inferredBy(tree, 'apps/desktop/app.json'), true);
      assert.deepEqual(readNxJson(tree)!.plugins, plugins, 'as nx.json had it');
    });
  }

  it("keeps the plugin off the workspace's other desktop-only apps", async () => {
    const tree = await integrated();
    await application(tree, {
      directory: 'apps/studio',
      desktopOnly: true,
      skipFormat: true,
      skipInstall: true,
    });
    await run(tree);
    assert.equal(inferredBy(tree, 'apps/desktop/app.json'), true);
    assert.equal(inferredBy(tree, 'apps/studio/app.json'), false);
  });

  it("registers the sync generator on the inferred prebuild, as a mobile app's is", async () => {
    const tree = await integrated();
    await run(tree);
    const desktop = readProjectConfiguration(tree, 'desktop').targets!;
    const phone = readProjectConfiguration(tree, 'mobile').targets!;
    assert.deepEqual(desktop['prebuild'], phone['prebuild']);
  });

  it("runs on the app's own Metro port when it is not Expo's default", async () => {
    const tree = await integrated();
    // The desktop app came second, so its Metro listens on 8082, which run:ios builds in.
    const { targets } = readProjectConfiguration(tree, 'desktop');
    assert.equal(targets!['start'].options.command, 'expo start --port 8082');
    await run(tree);
    const after = readProjectConfiguration(tree, 'desktop').targets!;
    for (const os of ['ios', 'android']) {
      assert.deepEqual(after[`run-${os}`], {
        executor: 'nx:run-commands',
        options: { cwd: 'apps/desktop', command: `expo run:${os} --port 8082` },
        continuous: true,
      });
    }
  });

  it("leaves run-ios and run-android to the plugin on Expo's default port", async () => {
    const tree = await pnpmWorkspace();
    await run(tree, '@proj/desktop');
    const { targets } = readProjectConfiguration(tree, '@proj/desktop');
    assert.equal(targets!['run-ios'], undefined);
    assert.equal(targets!['run-android'], undefined);
  });

  for (const [why, plugins] of [
    ['a broader exclude', [{ plugin: '@nx/expo/plugin', exclude: ['apps/**'] }]],
    ['an include that leaves the app out', [{ plugin: '@nx/expo/plugin', include: ['libs/**'] }]],
  ] as const) {
    it(`writes run-ios and run-android itself where ${why} keeps the plugin off the app`, async () => {
      const tree = await pnpmWorkspace();
      updateJson(tree, 'nx.json', (nxJson) => ({ ...nxJson, plugins: [...plugins] }));
      await run(tree, '@proj/desktop');
      assert.equal(inferredBy(tree, 'apps/desktop/app.json'), false, 'that registration kept');
      const { targets } = readProjectConfiguration(tree, '@proj/desktop');
      for (const os of ['ios', 'android']) {
        assert.deepEqual(targets![`run-${os}`], {
          executor: 'nx:run-commands',
          options: { cwd: 'apps/desktop', command: `expo run:${os}` },
          continuous: true,
        });
      }
    });
  }

  it('changes nothing run again', async () => {
    const tree = await integrated(['@nx/expo/plugin']);
    await run(tree);
    const files = [
      'nx.json',
      'package.json',
      'apps/desktop/app.json',
      'apps/desktop/package.json',
      'apps/desktop/project.json',
    ];
    const before = files.map((file) => tree.read(file, 'utf-8'));
    await run(tree);
    assert.deepEqual(
      files.map((file) => tree.read(file, 'utf-8')),
      before,
    );
  });

  it('changes nothing on an app that runs on iOS and Android already', async () => {
    const tree = await integrated();
    const files = ['nx.json', 'package.json', 'apps/mobile/app.json', 'apps/mobile/project.json'];
    const before = files.map((file) => tree.read(file, 'utf-8'));
    await run(tree, 'mobile');
    assert.deepEqual(
      files.map((file) => tree.read(file, 'utf-8')),
      before,
    );
  });

  it('refuses a project with no app.json, and changes nothing', async () => {
    const tree = await integrated();
    addProjectConfiguration(tree, 'web', { root: 'apps/web', targets: {} });
    tree.write('apps/web/package.json', '{ "name": "web" }\n');
    const files = ['package.json', 'nx.json', 'apps/web/project.json', 'apps/web/package.json'];
    const before = files.map((file) => tree.read(file, 'utf-8'));
    await assert.rejects(
      run(tree, 'web'),
      /web is not an Angular Native app: it has no apps\/web\/app\.json/,
    );
    assert.deepEqual(
      files.map((file) => tree.read(file, 'utf-8')),
      before,
    );
  });

  it('refuses a project the workspace does not have', async () => {
    const tree = await integrated();
    await assert.rejects(run(tree, 'nope'), /no project called "nope"/);
  });
});
