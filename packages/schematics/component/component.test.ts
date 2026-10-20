/**
 * `ng generate component` in a native project: native elements, and a test for the fake Fabric.
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
const { HostTree } = require('@angular-devkit/schematics') as {
  HostTree: new () => import('@angular-devkit/schematics').Tree;
};
const { UnitTestTree: TestTree } = require('@angular-devkit/schematics/testing') as {
  UnitTestTree: new (tree: import('@angular-devkit/schematics').Tree) => UnitTestTree;
};

const runner = new SchematicTestRunner(
  '@ng-native/schematics',
  path.resolve(import.meta.dirname, '../collection.json'),
);

/** An angular.json with one native project, which is all the component schematic reads. */
function workspace(): UnitTestTree {
  const tree = new TestTree(new HostTree());
  tree.create(
    'angular.json',
    JSON.stringify({
      version: 1,
      projects: {
        native: { root: 'projects/native', sourceRoot: 'projects/native', prefix: 'app' },
      },
    }),
  );
  return tree;
}

describe('ng generate component', () => {
  let tree: UnitTestTree;
  beforeEach(async () => {
    tree = await runner.runSchematic(
      'component',
      { name: 'profile-card', project: 'native' },
      workspace(),
    );
  });

  it('writes a component from native elements, in a folder of its own', () => {
    const source = tree.readContent('projects/native/src/app/profile-card/profile-card.ts');
    assert.match(source, /import \{ Text, View \} from '@ng-native\/components';/);
    assert.match(source, /selector: 'app-profile-card'/);
    assert.match(source, /imports: \[Text, View\]/);
    assert.match(source, /<view>\s*<text>profile-card works<\/text>\s*<\/view>/);
    assert.match(source, /export class ProfileCard \{\}/);
  });

  it('writes a test that renders it on the fake Fabric', () => {
    const test = tree.readContent('projects/native/src/app/profile-card/profile-card.test.ts');
    assert.match(test, /from '@ng-native\/testing'/);
    assert.match(test, /import \{ ProfileCard \} from '\.\/profile-card\.ts';/);
    assert.match(test, /screen\.getByText\('profile-card works'\)/);
  });

  it('writes no external template or stylesheet, and no TestBed spec', () => {
    assert.deepEqual(tree.getDir('projects/native/src/app/profile-card').subfiles.slice().sort(), [
      'profile-card.test.ts',
      'profile-card.ts',
    ]);
  });
});

describe('where it goes', () => {
  /** Where `avatar` is written when ng generate runs from `cwd`, as the CLI passes it in `path`. */
  async function from(cwd: string | undefined): Promise<string[]> {
    const tree = await runner.runSchematic(
      'component',
      { name: 'avatar', project: 'native', ...(cwd === undefined ? {} : { path: cwd }) },
      workspace(),
    );
    return tree.files.filter((file) => file.endsWith('/avatar.ts'));
  }

  it("into src/app, beside the app's own components, from the workspace root", async () => {
    assert.deepEqual(await from(undefined), ['/projects/native/src/app/avatar/avatar.ts']);
  });

  it("into src/app from the project's own directory, as the docs have it run", async () => {
    assert.deepEqual(await from('projects/native'), ['/projects/native/src/app/avatar/avatar.ts']);
  });

  it('into the directory ng generate ran from, when that is inside src', async () => {
    assert.deepEqual(await from('projects/native/src/app/settings'), [
      '/projects/native/src/app/settings/avatar/avatar.ts',
    ]);
  });

  it('into src itself when it ran from there', async () => {
    assert.deepEqual(await from('projects/native/src'), ['/projects/native/src/avatar/avatar.ts']);
  });

  it('into src/app when it ran from outside the project', async () => {
    assert.deepEqual(await from('projects/web/src'), ['/projects/native/src/app/avatar/avatar.ts']);
  });

  it('under a path given with the name, flat if asked, and without a test if asked', async () => {
    const tree = await runner.runSchematic(
      'component',
      { name: 'settings/ToggleRow', project: 'native', flat: true, skipTests: true },
      workspace(),
    );
    assert.match(
      tree.readContent('projects/native/src/app/settings/toggle-row.ts'),
      /export class ToggleRow/,
    );
    assert.equal(tree.exists('projects/native/src/app/settings/toggle-row.test.ts'), false);
  });

  it('refuses a project angular.json does not have', async () => {
    await assert.rejects(
      runner.runSchematic('component', { name: 'x', project: 'mobile' }, workspace()),
      /no project called "mobile"/,
    );
  });
});
