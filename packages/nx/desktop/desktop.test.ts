/**
 * `nx g @ng-native/nx:desktop <app>`: a generated app, set up to run on macOS.
 *
 * Each piece left out fails somewhere else: without `macos` in `expo.platforms` Metro does not
 * bundle for it, without the out-of-tree platforms flag Expo drops `macos` without a word, without
 * the plugin nothing checks the desktop options, and without the targets nothing runs the host.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { readJson, readProjectConfiguration, updateJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
const { application } = require('../application/index.cjs');
const { desktop } = require('./index.cjs');
const native = require('../native-app.cjs');
const { registry } = require('../save-exact.cjs') as {
  registry: { versions: (name: string, cwd: string) => Promise<string[]> };
};

registry.versions = async () => {
  throw new Error('offline');
};

async function app(directory = 'apps/mobile') {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@angular/core': '~22.2.0' },
    devDependencies: { nx: '23.2.0' },
  }));
  await application(tree, { directory, skipFormat: true, skipInstall: true });
  return tree;
}

const run = (tree: Tree, project = 'mobile') =>
  desktop(tree, { project, skipFormat: true, skipInstall: true });

describe('the desktop generator', () => {
  it('lists macos with the out-of-tree platforms flag and the config plugin', async () => {
    const tree = await app();
    await run(tree);
    const { expo } = readJson(tree, 'apps/mobile/app.json');
    assert.deepEqual(expo.platforms, ['ios', 'android', 'macos']);
    assert.equal(expo.experiments.outOfTreePlatforms, true);
    assert.deepEqual(expo.plugins, ['@ng-native/metro', '@ng-native/desktop']);
  });

  it('adds @ng-native/desktop at the framework version', async () => {
    const tree = await app();
    await run(tree);
    const { dependencies } = readJson(tree, 'package.json');
    assert.equal(
      dependencies['@ng-native/desktop'],
      native.desktopDependencies['@ng-native/desktop'],
    );
  });

  it('adds macos and package targets that run ng-native-desktop in the app', async () => {
    const tree = await app();
    await run(tree);
    const { targets } = readProjectConfiguration(tree, 'mobile');
    assert.deepEqual(targets!['macos'], {
      executor: 'nx:run-commands',
      options: { cwd: 'apps/mobile', command: 'ng-native-desktop run' },
      continuous: true,
    });
    assert.deepEqual(targets!['package'], {
      executor: 'nx:run-commands',
      options: { cwd: 'apps/mobile', command: 'ng-native-desktop package' },
    });
  });

  it("loads from the app's own Metro port when it is not Expo's default", async () => {
    const tree = await app();
    await application(tree, { directory: 'apps/second', skipFormat: true, skipInstall: true });
    await run(tree, 'second');
    const { targets } = readProjectConfiguration(tree, 'second');
    assert.equal(targets!['macos'].options.command, 'ng-native-desktop run --port 8082');
  });

  it("ignores the packaged apps in the app's .gitignore", async () => {
    const tree = await app();
    await run(tree);
    const ignore = tree.read('apps/mobile/.gitignore', 'utf-8')!;
    assert.match(ignore, /^\/dist\/macos$/m);
    assert.ok(ignore.startsWith(native.GITIGNORE), 'keeps what was there');
  });

  it('changes nothing run again', async () => {
    const tree = await app();
    await run(tree);
    const files = ['apps/mobile/app.json', 'apps/mobile/.gitignore', 'apps/mobile/project.json'];
    const before = files.map((file) => tree.read(file, 'utf-8'));
    await run(tree);
    assert.deepEqual(
      files.map((file) => tree.read(file, 'utf-8')),
      before,
    );
  });

  it('refuses a project the workspace does not have', async () => {
    const tree = await app();
    await assert.rejects(run(tree, 'nope'), /no project called "nope"/);
  });
});
