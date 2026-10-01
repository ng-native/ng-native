/**
 * The migration `nx migrate @ng-native/nx@latest` runs on every upgrade: it moves the `@ng-native/*`
 * packages each project's own `package.json` lists, which `nx migrate` does not touch. In a
 * workspace with package-manager workspaces that is where they are installed from.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { addProjectConfiguration, readJson, writeJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
const { syncAppVersions } = require('./sync-app-versions.cjs');
const own = require('../package.json');

const read = (file: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, file), 'utf8'));

function workspace() {
  const tree = createTreeWithEmptyWorkspace();
  addProjectConfiguration(tree, 'mobile', { root: 'apps/mobile' });
  writeJson(tree, 'apps/mobile/package.json', {
    name: '@acme/mobile',
    dependencies: {
      '@ng-native/components': '0.1.3',
      '@ng-native/platform': '^0.1.3',
      expo: '~57.0.26',
    },
    devDependencies: { '@ng-native/testing': '~0.1.3', vitest: '^5.0.0' },
  });
  return tree;
}

describe('the sync-app-versions migration', () => {
  it("moves every @ng-native package a project lists to this package's version", async () => {
    const tree = workspace();
    await syncAppVersions(tree);
    const app = readJson(tree, 'apps/mobile/package.json');
    assert.deepEqual(app.dependencies, {
      '@ng-native/components': own.version,
      '@ng-native/platform': `^${own.version}`,
      expo: '~57.0.26',
    });
    assert.deepEqual(app.devDependencies, {
      '@ng-native/testing': `~${own.version}`,
      vitest: '^5.0.0',
    });
  });

  it('moves a version with a prerelease or build suffix, and leaves a compound range', async () => {
    const tree = workspace();
    writeJson(tree, 'apps/mobile/package.json', {
      dependencies: {
        '@ng-native/components': '^0.1.3-alpha-test.1',
        '@ng-native/platform': '~0.1.3+build.1',
        '@ng-native/fabric': '>=0.1.0 <0.2.0',
      },
    });
    await syncAppVersions(tree);
    assert.deepEqual(readJson(tree, 'apps/mobile/package.json').dependencies, {
      '@ng-native/components': `^${own.version}`,
      '@ng-native/platform': `~${own.version}`,
      '@ng-native/fabric': '>=0.1.0 <0.2.0',
    });
  });

  it('leaves a workspace link, a peer range and a project with no package.json alone', async () => {
    const tree = workspace();
    addProjectConfiguration(tree, 'ui', { root: 'libs/ui' });
    addProjectConfiguration(tree, 'bare', { root: 'libs/bare' });
    writeJson(tree, 'libs/ui/package.json', {
      name: '@acme/ui',
      dependencies: { '@ng-native/fabric': 'workspace:*' },
      peerDependencies: { '@ng-native/components': '>=0.1.0' },
    });
    await syncAppVersions(tree);
    const ui = readJson(tree, 'libs/ui/package.json');
    assert.equal(ui.dependencies['@ng-native/fabric'], 'workspace:*');
    assert.equal(ui.peerDependencies['@ng-native/components'], '>=0.1.0');
    assert.equal(tree.exists('libs/bare/package.json'), false);
  });

  it('says to install, since nx migrate installs only when the root package.json changes', async () => {
    // nx migrate --run-migrations ignores a returned callback, and it prints nextSteps.
    const tree = workspace();
    tree.write('pnpm-lock.yaml', '');
    assert.deepEqual(await syncAppVersions(tree), [
      'Run pnpm install to install the @ng-native versions the projects now list.',
    ]);
    assert.deepEqual(await syncAppVersions(tree), []);
  });

  it("is registered at this package's version, so every upgrade runs it", () => {
    // nx migrate runs a migration when the upgrade crosses its version, and the release moves this
    // one to each release's version.
    const { generators } = read('../migrations.json');
    assert.equal(generators['sync-app-versions'].version, own.version);
    assert.equal(
      generators['sync-app-versions'].implementation,
      './migrations/sync-app-versions.cjs#syncAppVersions',
    );
    assert.equal(own['nx-migrations'].migrations, './migrations.json');
    assert.ok(own.files.includes('migrations.json'));
  });
});
