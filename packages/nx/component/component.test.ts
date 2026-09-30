/**
 * `nx g @ng-native/nx:component`: native elements, and a test for the fake Fabric, as
 * `@ng-native/schematics`' component schematic writes them for the Angular CLI.
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
const { addProjectConfiguration } = require('@nx/devkit') as typeof import('@nx/devkit');
const { component } = require('./index.cjs');
const { componentSource, testSource } = require('./sources.cjs');

function workspace() {
  const tree = createTreeWithEmptyWorkspace();
  addProjectConfiguration(tree, 'ui', {
    root: 'packages/ui',
    sourceRoot: 'packages/ui/src',
    projectType: 'library',
    prefix: 'lib',
  } as Parameters<typeof addProjectConfiguration>[2]);
  addProjectConfiguration(tree, 'mobile', {
    root: 'apps/mobile',
    sourceRoot: 'apps/mobile',
    projectType: 'application',
  });
  return tree;
}

const generate = (tree: Tree, options: object) => component(tree, { skipFormat: true, ...options });

describe('nx g @ng-native/nx:component', () => {
  it("writes a library's component from native elements, in a folder of its own under src/lib", async () => {
    const tree = workspace();
    await generate(tree, { name: 'profile-card', project: 'ui' });
    assert.equal(
      tree.read('packages/ui/src/lib/profile-card/profile-card.ts', 'utf-8'),
      componentSource('ProfileCard', 'lib-profile-card', 'profile-card works'),
    );
  });

  it('writes a test beside it that renders it on the fake Fabric', async () => {
    const tree = workspace();
    await generate(tree, { name: 'profile-card', project: 'ui' });
    assert.equal(
      tree.read('packages/ui/src/lib/profile-card/profile-card.test.ts', 'utf-8'),
      testSource('ProfileCard', 'profile-card', 'profile-card works'),
    );
  });

  it("puts an app's component under src/app, with no prefix when the project has none", async () => {
    const tree = workspace();
    await generate(tree, { name: 'profile-card', project: 'mobile' });
    const source = tree.read('apps/mobile/src/app/profile-card/profile-card.ts', 'utf-8') ?? '';
    assert.match(source, /selector: 'profile-card'/);
    assert.ok(tree.exists('apps/mobile/src/app/profile-card/profile-card.test.ts'));
  });

  it('takes a path in the name, and --flat leaves out the folder of its own', async () => {
    const tree = workspace();
    await generate(tree, { name: 'settings/profile-card', project: 'ui' });
    await generate(tree, { name: 'settings/avatar', project: 'ui', flat: true });
    assert.ok(tree.exists('packages/ui/src/lib/settings/profile-card/profile-card.ts'));
    assert.ok(tree.exists('packages/ui/src/lib/settings/avatar.ts'));
    assert.ok(tree.exists('packages/ui/src/lib/settings/avatar.test.ts'));
  });

  it('writes no test with --skipTests, and no external template, stylesheet or spec', async () => {
    const tree = workspace();
    await generate(tree, { name: 'profile-card', project: 'ui', skipTests: true });
    const folder = 'packages/ui/src/lib/profile-card';
    assert.deepEqual(tree.children(folder), ['profile-card.ts']);
  });

  it('names the project it cannot find', async () => {
    await assert.rejects(generate(workspace(), { name: 'card', project: 'nope' }), /nope/);
  });

  it("writes the same files as @ng-native/schematics' component schematic", () => {
    const own = readFileSync(path.join(import.meta.dirname, 'sources.cjs'), 'utf8');
    const schematics = path.join(import.meta.dirname, '../../schematics/component/sources.cjs');
    assert.equal(own, readFileSync(schematics, 'utf8'));
  });
});
