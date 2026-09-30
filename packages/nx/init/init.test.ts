/**
 * `nx add @ng-native/nx`: `@nx/expo` at the workspace's Nx version, and its plugin registered.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { readJson, readNxJson, updateJson, updateNxJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
const { init, EXPO_PLUGIN } = require('./index.cjs');
const native = require('../native-app.cjs');

function workspace(nx = '23.2.0') {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({ ...manifest, devDependencies: { nx } }));
  return tree;
}

describe('init', () => {
  it("adds @nx/expo at the workspace's own Nx version", async () => {
    const tree = workspace('23.1.4');
    await init(tree, { skipFormat: true });
    assert.equal(readJson(tree, 'package.json').devDependencies['@nx/expo'], '23.1.4');
  });

  it("adds @nx/expo, and react-dom and the Expo CLI at the app's versions rather than init's", async () => {
    const tree = workspace();
    await init(tree, { skipFormat: true });
    const manifest = readJson(tree, 'package.json');
    assert.deepEqual(Object.keys(manifest.devDependencies).sort(), [
      '@babel/core',
      '@babel/runtime',
      '@expo/cli',
      '@nx/expo',
      'nx',
      'react-dom',
    ]);
    assert.equal(manifest.devDependencies['react-dom'], '19.2.3');
    assert.match(manifest.devDependencies['@expo/cli'], /^\^57\./);
    assert.deepEqual(manifest.dependencies, {});
  });

  it("puts Babel 7's runtime at the root, where Expo's Babel preset imports it from", async () => {
    // @angular-devkit/build-angular hoists Babel 8's runtime there, which has no `regenerator`, and
    // every `nx start` warned that Metro had to fall back to file-based resolution to find it.
    const tree = workspace();
    await init(tree, { skipFormat: true });
    assert.match(readJson(tree, 'package.json').devDependencies['@babel/runtime'], /^\^7\./);
  });

  it("puts Babel 7's core at the root, which every plugin in Expo's Babel preset peers on", async () => {
    // The same hoisted Babel 8 answered those plugins' `@babel/core` peer, and pnpm reported it
    // unmet after nx add until an app generator added Babel 7's core.
    const tree = workspace();
    await init(tree, { skipFormat: true });
    const { devDependencies } = readJson(tree, 'package.json');
    assert.equal(devDependencies['@babel/core'], native.devDependencies['@babel/core']);
  });

  it("pins the root's Expo peers to the app's versions in a package-manager workspace", async () => {
    // pnpm installs @nx/expo's `expo` peer in the root's context, before any app exists, and
    // took that Expo's own peers at the newest there were: React Native 0.87.1 and React 19.3.0
    // stayed in the lockfile beside the app's 0.86.3 and 19.2.3.
    const tree = workspace();
    tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    await init(tree, { skipFormat: true });
    const { devDependencies } = readJson(tree, 'package.json');
    assert.deepEqual(Object.keys(devDependencies).sort(), [
      '@babel/core',
      '@babel/runtime',
      '@nx/expo',
      'expo',
      'nx',
      'react',
      'react-dom',
      'react-native',
    ]);
    assert.equal(devDependencies.expo, '~57.0.26');
    assert.equal(devDependencies.react, '19.2.3');
    assert.equal(devDependencies['react-dom'], '19.2.3');
    assert.equal(devDependencies['react-native'], '0.86.3');
  });

  it('keeps a React the root of a package-manager workspace already has', async () => {
    const tree = workspace();
    updateJson(tree, 'package.json', (manifest) => ({
      ...manifest,
      workspaces: ['packages/*'],
      dependencies: { react: '19.2.3' },
    }));
    await init(tree, { skipFormat: true });
    const manifest = readJson(tree, 'package.json');
    assert.equal(manifest.dependencies.react, '19.2.3');
    assert.equal(manifest.devDependencies.react, undefined);
  });

  it("registers @nx/expo's plugin, with the target names Nx documents", async () => {
    const tree = workspace();
    await init(tree, { skipFormat: true });
    const plugin = readNxJson(tree)?.plugins?.find(
      (entry) => typeof entry !== 'string' && entry.plugin === '@nx/expo/plugin',
    );
    assert.deepEqual(plugin, EXPO_PLUGIN);
  });

  it('leaves a plugin entry and an @nx/expo that are already there alone', async () => {
    const tree = workspace();
    updateNxJson(tree, { ...readNxJson(tree), plugins: ['@nx/expo/plugin'] });
    updateJson(tree, 'package.json', (manifest) => {
      manifest.devDependencies['@nx/expo'] = '23.0.0';
      return manifest;
    });
    await init(tree, { skipFormat: true });
    assert.deepEqual(readNxJson(tree)?.plugins, ['@nx/expo/plugin']);
    assert.equal(readJson(tree, 'package.json').devDependencies['@nx/expo'], '23.0.0');
  });

  it('returns a task that installs, unless asked not to', async () => {
    assert.equal(typeof (await init(workspace(), { skipFormat: true })), 'function');
    const skipped = await init(workspace(), { skipFormat: true, skipInstall: true });
    assert.equal(skipped(), undefined);
  });
});

describe('in a pnpm workspace', () => {
  // pnpm 11 stops the install with ERR_PNPM_IGNORED_BUILDS for any dependency with an install
  // script the workspace has not decided on. @nx/expo brings two, through @nx/jest: @parcel/watcher
  // and unrs-resolver. Both ship prebuilt binaries, and their scripts only build from source.
  const decided = (yaml: string) =>
    Object.fromEntries(
      [...yaml.matchAll(/^ {2}'?([@\w/.-]+)'?:\s*(.+)$/gm)].map(([, name, value]) => [name, value]),
    );

  it('declines the builds @nx/expo brings, beside the ones the workspace decided', async () => {
    const tree = workspace();
    tree.write(
      'pnpm-workspace.yaml',
      "packages:\n  - 'packages/*'\nallowBuilds:\n  '@swc/core': true\n  nx: true\n",
    );
    await init(tree, { skipFormat: true });
    const yaml = tree.read('pnpm-workspace.yaml', 'utf-8')!;
    assert.deepEqual(decided(yaml), {
      '@swc/core': 'true',
      nx: 'true',
      '@parcel/watcher': 'false',
      'unrs-resolver': 'false',
    });
    assert.match(yaml, /^packages:\n {2}- 'packages\/\*'\n/);
  });

  it('keeps a decision already made, and settles the placeholder a refused install leaves', async () => {
    const tree = workspace();
    tree.write(
      'pnpm-workspace.yaml',
      "allowBuilds:\n  '@parcel/watcher': true\n  unrs-resolver: set this to true or false\n",
    );
    await init(tree, { skipFormat: true });
    assert.deepEqual(decided(tree.read('pnpm-workspace.yaml', 'utf-8')!), {
      '@parcel/watcher': 'true',
      'unrs-resolver': 'false',
    });
  });

  it('adds the setting to a pnpm-workspace.yaml with none, or writes one beside a pnpm lockfile', async () => {
    const listed = workspace();
    listed.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    await init(listed, { skipFormat: true });
    assert.equal(
      listed.read('pnpm-workspace.yaml', 'utf-8'),
      "packages:\n  - 'packages/*'\n\nallowBuilds:\n  '@parcel/watcher': false\n  unrs-resolver: false\n",
    );

    const integrated = workspace();
    integrated.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    await init(integrated, { skipFormat: true });
    assert.equal(
      integrated.read('pnpm-workspace.yaml', 'utf-8'),
      "allowBuilds:\n  '@parcel/watcher': false\n  unrs-resolver: false\n",
    );
  });

  it('leaves a workspace on another package manager alone', async () => {
    const tree = workspace();
    await init(tree, { skipFormat: true });
    assert.equal(tree.exists('pnpm-workspace.yaml'), false);
  });
});
