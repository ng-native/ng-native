/**
 * `ng generate @ng-native/schematics:desktop native`, on an app `ng add` made beside a web app.
 *
 * Each piece left out fails somewhere else: without `macos` in `expo.platforms` Metro does not
 * bundle for it, without the out-of-tree platforms flag Expo drops `macos` without a word, without
 * the plugin nothing checks the desktop options, and without the targets nothing runs the host.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type {
  SchematicTestRunner as Runner,
  UnitTestTree,
} from '@angular-devkit/schematics/testing';

const require = createRequire(import.meta.url);
const { SchematicTestRunner } = require('@angular-devkit/schematics/testing') as {
  SchematicTestRunner: typeof Runner;
};
const collection = path.resolve(import.meta.dirname, '../collection.json');
const { version } = require('../package.json') as { version: string };

const angular = new SchematicTestRunner(
  '@schematics/angular',
  path.join(path.dirname(require.resolve('@schematics/angular/package.json')), 'collection.json'),
);

const json = (tree: UnitTestTree, file: string) => JSON.parse(tree.readContent(file));

describe('the desktop schematic', () => {
  let runner: Runner;
  let tree: UnitTestTree;
  beforeEach(async () => {
    runner = new SchematicTestRunner('@ng-native/schematics', collection);
    const web = await angular.runSchematic('workspace', {
      name: 'shop',
      newProjectRoot: 'projects',
      version: '22.1.5',
    });
    tree = await runner.runSchematic('ng-add', { skipInstall: true }, web);
    tree = await runner.runSchematic('desktop', { project: 'native', skipInstall: true }, tree);
  });

  it('lists macos with the out-of-tree platforms flag and the config plugin', () => {
    const { expo } = json(tree, 'projects/native/app.json');
    assert.deepEqual(expo.platforms, ['ios', 'android', 'macos']);
    assert.equal(expo.experiments.outOfTreePlatforms, true);
    assert.deepEqual(expo.plugins, ['@ng-native/metro', '@ng-native/desktop']);
  });

  it('adds @ng-native/desktop to the workspace at the framework version', () => {
    assert.equal(json(tree, 'package.json').dependencies['@ng-native/desktop'], version);
  });

  it('adds macos and package targets on the expo builder', () => {
    const { architect } = json(tree, 'angular.json').projects.native;
    assert.deepEqual(architect.macos, {
      builder: '@ng-native/schematics:expo',
      options: { command: 'macos' },
    });
    assert.deepEqual(architect.package, {
      builder: '@ng-native/schematics:expo',
      options: { command: 'package' },
    });
  });

  it("ignores the packaged apps in the project's .gitignore, keeping what is there", () => {
    const ignore = tree.readContent('projects/native/.gitignore');
    assert.match(ignore, /^\/dist\/macos$/m);
    assert.match(ignore, /^\/ios$/m);
  });

  it('changes nothing run again', async () => {
    const files = ['projects/native/app.json', 'projects/native/.gitignore', 'angular.json'];
    const before = files.map((file) => tree.readContent(file));
    const again = await runner.runSchematic(
      'desktop',
      { project: 'native', skipInstall: true },
      tree,
    );
    assert.deepEqual(
      files.map((file) => again.readContent(file)),
      before,
    );
  });

  it('refuses a project angular.json does not have', async () => {
    await assert.rejects(
      runner.runSchematic('desktop', { project: 'nope', skipInstall: true }, tree),
      /no project called "nope"/,
    );
  });
});
