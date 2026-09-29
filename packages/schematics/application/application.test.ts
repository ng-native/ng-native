/**
 * `ng add` and `ng generate application`, run against a workspace Angular's own schematics made.
 *
 * The scratch workspace is the one `ng new` writes, web app included, so what these check is the
 * real situation: a native app added beside a web app that has to keep working.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type {
  SchematicTestRunner as Runner,
  UnitTestTree,
} from '@angular-devkit/schematics/testing';

const require = createRequire(import.meta.url);
// A directory import, which only CommonJS resolution allows.
const { SchematicTestRunner } = require('@angular-devkit/schematics/testing') as {
  SchematicTestRunner: typeof Runner;
};
const collection = path.resolve(import.meta.dirname, '../collection.json');
// The framework packages are released in lockstep with this one, at its version.
const { version } = require('../package.json') as { version: string };
const template = path.resolve(import.meta.dirname, '../../../template');

// Through the manifest: the package's `exports` map would resolve `collection.json` to a `.js`.
const angular = new SchematicTestRunner(
  '@schematics/angular',
  path.join(path.dirname(require.resolve('@schematics/angular/package.json')), 'collection.json'),
);

async function webWorkspace(): Promise<UnitTestTree> {
  const tree = await angular.runSchematic('workspace', {
    name: 'shop',
    newProjectRoot: 'projects',
    version: '22.1.5',
  });
  return angular.runSchematic('application', { name: 'web', skipInstall: true }, tree);
}

const json = (tree: UnitTestTree, file: string) => JSON.parse(tree.readContent(file));

describe('ng add', () => {
  let runner: Runner;
  let tree: UnitTestTree;
  beforeEach(async () => {
    runner = new SchematicTestRunner('@ng-native/schematics', collection);
    tree = await runner.runSchematic('ng-add', {}, await webWorkspace());
  });

  it("writes the template's app under projects/native", () => {
    for (const file of [
      'src/app/app.ts',
      'src/main.ts',
      'src/app/app.test.ts',
      'metro.config.js',
      'tsconfig.json',
    ]) {
      assert.equal(
        tree.readContent(`projects/native/${file}`),
        readFileSync(path.join(template, file), 'utf8'),
        file,
      );
    }
    assert.equal(json(tree, 'projects/native/app.json').expo.slug, 'native');
  });

  it('writes an AGENTS.md with the commands this workspace runs, and a CLAUDE.md that reads it', () => {
    const agents = tree.readContent('projects/native/AGENTS.md');
    assert.match(agents, /^ng run native:run-ios +# the iOS simulator$/m);
    assert.match(agents, /Run `ng test native` after a change/);
    assert.doesNotMatch(agents, /npm (start|test)/);
    assert.equal(tree.readContent('projects/native/CLAUDE.md'), '@AGENTS.md\n');
  });

  it('gives the project the package.json Expo reads, naming every native module it links', () => {
    // Expo links only the native modules this file names, and `expo run:ios` rewrites it and
    // offers to install into the project if expo, react or react-native is missing.
    const manifest = json(tree, 'projects/native/package.json');
    assert.equal(manifest.main, 'src/main.ts');
    assert.equal(manifest.dependencies['react-native'], '0.86.3');
    assert.equal(manifest.dependencies['react-native-safe-area-context'], '~5.7.0');
    assert.equal(manifest.dependencies['expo-status-bar'], '~57.0.1');
  });

  it('registers the project with targets that run Expo and the tests', () => {
    const project = json(tree, 'angular.json').projects.native;
    assert.equal(project.root, 'projects/native');
    assert.deepEqual(project.architect.serve, {
      builder: '@ng-native/schematics:expo',
      options: { command: 'start' },
    });
    assert.deepEqual(project.architect.build.options, {
      command: 'export',
      args: ['--output-dir', '../../dist/native'],
    });
    assert.equal(project.architect['run-ios'].options.command, 'run:ios');
    assert.equal(project.architect['run-android'].options.command, 'run:android');
    assert.equal(project.architect.test.builder, '@ng-native/schematics:vitest');
  });

  it("routes ng generate in the project to this collection first, then Angular's", () => {
    const project = json(tree, 'angular.json').projects.native;
    assert.deepEqual(project.cli.schematicCollections, [
      '@ng-native/schematics',
      '@schematics/angular',
    ]);
  });

  it("stops Angular's own schematics writing a spec the project cannot run", () => {
    const { schematics } = json(tree, 'angular.json').projects.native;
    assert.deepEqual(schematics['@schematics/angular:service'], { skipTests: true });
    assert.deepEqual(schematics['@schematics/angular:component'], { skipTests: true });
  });

  it('leaves the web project exactly as it was', async () => {
    const before = json(await webWorkspace(), 'angular.json').projects.web;
    assert.deepEqual(json(tree, 'angular.json').projects.web, before);
  });

  it("adds the app's dependencies and keeps every version the workspace already had", async () => {
    const manifest = json(tree, 'package.json');
    assert.equal(manifest.dependencies.expo, '~57.0.20');
    assert.equal(manifest.dependencies['react-native'], '0.86.3');
    assert.equal(manifest.dependencies['@ng-native/platform'], version);
    assert.equal(manifest.devDependencies['@ng-native/testing'], version);

    const before = json(await webWorkspace(), 'package.json');
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const [name, range] of Object.entries(before[field])) {
        assert.equal(manifest[field][name], range, name);
      }
    }
  });

  it("ignores Expo's cache directory", () => {
    assert.match(tree.readContent('.gitignore'), /^\.expo\/$/m);
  });

  it('installs what it added', () => {
    assert.deepEqual(
      runner.tasks.map((task) => task.name),
      ['node-package'],
    );
  });
});

describe('ng generate application', () => {
  it('ignores the Expo cache once, however many apps are added', async () => {
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    let tree = await runner.runSchematic('ng-add', {}, await webWorkspace());
    tree = await runner.runSchematic('application', { name: 'second', skipInstall: true }, tree);
    assert.equal(tree.readContent('.gitignore').match(/^\.expo\/$/gm)?.length, 1);
  });

  it('takes a name and a directory', async () => {
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    const tree = await runner.runSchematic(
      'application',
      { name: 'field', directory: 'apps/field', skipInstall: true },
      await webWorkspace(),
    );
    assert.ok(tree.exists('apps/field/src/main.ts'));
    const project = json(tree, 'angular.json').projects.field;
    assert.equal(project.root, 'apps/field');
    assert.deepEqual(project.architect.build.options.args, ['--output-dir', '../../dist/field']);
    assert.deepEqual(runner.tasks, []);
  });

  it('keeps the Vitest an Angular CLI 22.1 workspace starts with, and says nothing', async () => {
    // `ng new` on 22.1 writes vitest ^4, and 22.2 writes ^5. The Vitest plugin runs on both.
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    const workspace = await webWorkspace();
    const warnings: string[] = [];
    runner.logger.subscribe((entry) => {
      if (entry.level === 'warn') warnings.push(entry.message);
    });
    const tree = await runner.runSchematic(
      'application',
      { name: 'native', skipInstall: true },
      workspace,
    );
    assert.equal(json(tree, 'package.json').devDependencies.vitest, '^4.0.8');
    assert.deepEqual(warnings, []);
  });

  it('refuses a name angular.json already has', async () => {
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    await assert.rejects(
      runner.runSchematic('application', { name: 'web' }, await webWorkspace()),
      /already has a project called "web"/,
    );
  });

  it('refuses a directory that is not an Angular CLI workspace, and says what to use instead', async () => {
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    const empty = await angular.runSchematic('workspace', { name: 'x', version: '22.1.5' });
    empty.delete('angular.json');
    await assert.rejects(
      runner.runSchematic('application', { name: 'native' }, empty),
      /create-expo-app@latest my-app --template @ng-native\/template/,
    );
  });

  it('warns about a dependency npm would refuse to install beside it', async () => {
    const runner = new SchematicTestRunner('@ng-native/schematics', collection);
    const workspace = await webWorkspace();
    const manifest = json(workspace, 'package.json');
    manifest.dependencies['@angular/core'] = '21.2.0';
    manifest.devDependencies.vitest = '^5.0.0';
    workspace.overwrite('package.json', JSON.stringify(manifest));

    const warnings: string[] = [];
    runner.logger.subscribe((entry) => {
      if (entry.level === 'warn') warnings.push(entry.message);
    });
    await runner.runSchematic('application', { name: 'native', skipInstall: true }, workspace);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /@angular\/core is 21\.2\.0 here/);
  });
});
