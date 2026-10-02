/**
 * The migration `ng update @ng-native/schematics` runs on every upgrade: it moves the
 * `@ng-native/*` packages each project's own `package.json` lists, which `ng update` does not touch.
 * Expo autolinks the native modules that file names, and `expo prebuild` reads its versions.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import type {
  SchematicTestRunner as Runner,
  UnitTestTree as Tree,
} from '@angular-devkit/schematics/testing';

const require = createRequire(import.meta.url);
const { SchematicTestRunner, UnitTestTree } = require('@angular-devkit/schematics/testing') as {
  SchematicTestRunner: typeof Runner;
  UnitTestTree: typeof Tree;
};
const { HostTree } = require('@angular-devkit/schematics') as {
  HostTree: new () => ConstructorParameters<typeof Tree>[0];
};
const own = require('../package.json');
const read = (file: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, file), 'utf8'));

function workspace() {
  const tree = new UnitTestTree(new HostTree());
  const json = (file: string, value: unknown) => tree.create(file, JSON.stringify(value, null, 2));
  json('angular.json', {
    version: 1,
    projects: { web: { root: '' }, native: { root: 'projects/native' } },
  });
  json('package.json', { name: 'shop', dependencies: { '@ng-native/platform': '0.1.3' } });
  json('projects/native/package.json', {
    name: 'native',
    dependencies: {
      '@ng-native/components': '0.1.3',
      '@ng-native/platform': '^0.1.3',
      '@ng-native/fabric': 'file:../fabric',
      expo: '~57.0.26',
    },
  });
  return tree;
}

describe('the sync-app-versions migration', () => {
  const runner = new SchematicTestRunner(
    '@ng-native/schematics',
    path.join(import.meta.dirname, '../migrations.json'),
  );

  it("moves every @ng-native package a project lists to this package's version", async () => {
    const tree = await runner.runSchematic('sync-app-versions', {}, workspace());
    const app = JSON.parse(tree.readContent('projects/native/package.json'));
    assert.deepEqual(app.dependencies, {
      '@ng-native/components': own.version,
      '@ng-native/platform': `^${own.version}`,
      '@ng-native/fabric': 'file:../fabric',
      expo: '~57.0.26',
    });
  });

  it('finds the native project whatever angular.json holds, comments and trailing commas too', async () => {
    const tree = workspace();
    tree.overwrite(
      'angular.json',
      `{
        // The native app, beside the web one.
        "version": 1,
        "projects": { "native": { "root": "projects/native", }, },
      }`,
    );
    const after = await runner.runSchematic('sync-app-versions', {}, tree);
    const app = JSON.parse(after.readContent('projects/native/package.json'));
    assert.equal(app.dependencies['@ng-native/components'], own.version);
  });

  it('moves a version with a prerelease or build suffix, and leaves a compound range', async () => {
    const tree = workspace();
    tree.overwrite(
      'projects/native/package.json',
      JSON.stringify({
        dependencies: {
          '@ng-native/components': '^0.1.3-alpha-test.1',
          '@ng-native/platform': '~0.1.3+build.1',
          '@ng-native/fabric': '>=0.1.0 <0.2.0',
        },
      }),
    );
    const after = await runner.runSchematic('sync-app-versions', {}, tree);
    assert.deepEqual(JSON.parse(after.readContent('projects/native/package.json')).dependencies, {
      '@ng-native/components': `^${own.version}`,
      '@ng-native/platform': `~${own.version}`,
      '@ng-native/fabric': '>=0.1.0 <0.2.0',
    });
  });

  it('leaves a package.json with nothing to move as it was written', async () => {
    const tree = workspace();
    const compact = '{"name":"shop","dependencies":{"@ng-native/platform":"workspace:*"}}';
    tree.overwrite('package.json', compact);
    const after = await runner.runSchematic('sync-app-versions', {}, tree);
    assert.equal(after.readContent('package.json'), compact);
  });

  it("is registered at this package's version, so every ng update runs it", () => {
    const { schematics } = read('../migrations.json');
    assert.equal(schematics['sync-app-versions'].version, own.version);
    assert.equal(own['ng-update'].migrations, './migrations.json');
    assert.ok(own.files.includes('migrations.json'));
  });

  it('updates every published @ng-native package together', () => {
    const packages = path.resolve(import.meta.dirname, '../..');
    const nx = JSON.parse(readFileSync(path.join(packages, 'nx/package.json'), 'utf8'));
    const published = [...nx['nx-migrations'].packageGroup].sort();
    assert.deepEqual([...own['ng-update'].packageGroup].sort(), published);
  });

  it('is what ng update with no package names suggests, not the first package in the group', () => {
    // Without a packageGroupName the Angular CLI names the group for its first installed member,
    // and suggested ng update @ng-native/components, which moves that package alone.
    assert.equal(own['ng-update'].packageGroupName, own.name);
    assert.ok(own['ng-update'].packageGroup.includes(own.name));
  });
});
