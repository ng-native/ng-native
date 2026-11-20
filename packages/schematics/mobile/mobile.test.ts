/**
 * `ng generate @ng-native/schematics:mobile native`, on a desktop-only app `ng add` made beside a
 * web app.
 *
 * It undoes what `--desktop-only` left out: without `ios` and `android` in `expo.platforms` Metro
 * does not bundle for them, without the Android package `expo prebuild` stops to ask for one,
 * without `expo-status-bar` and `expo-system-ui` the app has a desktop app's dependencies, and
 * without the targets nothing runs it on a simulator.
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
const native = require('../native-app.cjs');
const collection = path.resolve(import.meta.dirname, '../collection.json');

const angular = new SchematicTestRunner(
  '@schematics/angular',
  path.join(path.dirname(require.resolve('@schematics/angular/package.json')), 'collection.json'),
);

const json = (tree: UnitTestTree, file: string) => JSON.parse(tree.readContent(file));

async function workspace(runner: Runner, desktopOnly: boolean) {
  const web = await angular.runSchematic('workspace', {
    name: 'shop',
    newProjectRoot: 'projects',
    version: '22.1.5',
  });
  return runner.runSchematic('ng-add', { skipInstall: true, desktopOnly }, web);
}

describe('the mobile schematic', () => {
  let runner: Runner;
  let tree: UnitTestTree;
  beforeEach(async () => {
    runner = new SchematicTestRunner('@ng-native/schematics', collection);
    tree = await workspace(runner, true);
    tree = await runner.runSchematic('mobile', { project: 'native', skipInstall: true }, tree);
  });

  it("writes the phone settings a mobile app's app.json has, keeping macOS", () => {
    const { expo } = json(tree, 'projects/native/app.json');
    const bundle = expo.ios.bundleIdentifier;
    // What an app made for iOS and Android, then given the desktop OSes, has.
    const expected = JSON.parse(
      native.appJson('native', bundle, ['ios', 'android', 'macos', 'linux']),
    );
    assert.deepEqual(expo, expected.expo);
    assert.deepEqual(expo.platforms, ['ios', 'android', 'macos', 'linux']);
    assert.equal(expo.android.package, bundle);
  });

  it("adds the phone's status bar and system UI packages to the workspace and the app", () => {
    const root = json(tree, 'package.json').dependencies;
    // Expo autolinks only the native modules the app's own package.json names.
    const pins = json(tree, 'projects/native/package.json').dependencies;
    for (const name of ['expo-status-bar', 'expo-system-ui']) {
      assert.equal(root[name], native.dependencies[name], name);
      assert.equal(pins[name], native.dependencies[name], name);
    }
  });

  it('adds them to the workspace alone for a project with no package.json of its own', async () => {
    const desktop = await workspace(runner, true);
    desktop.delete('projects/native/package.json');
    const again = await runner.runSchematic(
      'mobile',
      { project: 'native', skipInstall: true },
      desktop,
    );
    assert.equal(again.exists('projects/native/package.json'), false);
    assert.equal(json(again, 'package.json').dependencies['expo-system-ui'], '~58.0.6');
  });

  it('adds run-ios and run-android targets on the expo builder', () => {
    const { architect } = json(tree, 'angular.json').projects.native;
    assert.deepEqual(architect['run-ios'], {
      builder: '@ng-native/schematics:expo',
      options: { command: 'run:ios' },
    });
    assert.deepEqual(architect['run-android'], {
      builder: '@ng-native/schematics:expo',
      options: { command: 'run:android' },
    });
  });

  it("runs on the serve target's port, given as an option or in its args", async () => {
    for (const serve of [{ port: 8082 }, { args: ['--port', '8082'] }, { args: ['--port=8082'] }]) {
      let ported = await workspace(runner, true);
      const config = json(ported, 'angular.json');
      Object.assign(config.projects.native.architect.serve.options, serve);
      ported.overwrite('angular.json', JSON.stringify(config, null, 2));
      ported = await runner.runSchematic(
        'mobile',
        { project: 'native', skipInstall: true },
        ported,
      );
      const { architect } = json(ported, 'angular.json').projects.native;
      assert.deepEqual(architect['run-ios'].options, { command: 'run:ios', port: 8082 });
      assert.deepEqual(architect['run-android'].options, { command: 'run:android', port: 8082 });
    }
  });

  it("takes the port from the serve target's default configuration, over its options", async () => {
    let ported = await workspace(runner, true);
    const config = json(ported, 'angular.json');
    const serve = config.projects.native.architect.serve;
    serve.options.port = 8081;
    serve.configurations = { ...serve.configurations, desk: { port: 8083 } };
    serve.defaultConfiguration = 'desk';
    ported.overwrite('angular.json', JSON.stringify(config, null, 2));
    ported = await runner.runSchematic('mobile', { project: 'native', skipInstall: true }, ported);
    const { architect } = json(ported, 'angular.json').projects.native;
    assert.deepEqual(architect['run-ios'].options, { command: 'run:ios', port: 8083 });
  });

  it('reads the serve options as Angular merges them: configurations in order, arrays replaced', async () => {
    let ported = await workspace(runner, true);
    const config = json(ported, 'angular.json');
    const serve = config.projects.native.architect.serve;
    serve.options.args = ['--port', '8082'];
    serve.configurations = { ...serve.configurations, a: { port: 8084 }, b: { args: [] } };
    serve.defaultConfiguration = 'a, b';
    ported.overwrite('angular.json', JSON.stringify(config, null, 2));
    ported = await runner.runSchematic('mobile', { project: 'native', skipInstall: true }, ported);
    const { architect } = json(ported, 'angular.json').projects.native;
    assert.deepEqual(architect['run-ios'].options, { command: 'run:ios', port: 8084 });
    serve.defaultConfiguration = 'b';
    let replaced = await workspace(runner, true);
    replaced.overwrite('angular.json', JSON.stringify(config, null, 2));
    replaced = await runner.runSchematic(
      'mobile',
      { project: 'native', skipInstall: true },
      replaced,
    );
    const after = json(replaced, 'angular.json').projects.native.architect;
    assert.deepEqual(after['run-ios'].options, { command: 'run:ios' }, 'args replaced, no port');
  });

  it('changes nothing run again', async () => {
    const files = [
      'projects/native/app.json',
      'projects/native/package.json',
      'package.json',
      'angular.json',
    ];
    const before = files.map((file) => tree.readContent(file));
    const again = await runner.runSchematic(
      'mobile',
      { project: 'native', skipInstall: true },
      tree,
    );
    assert.deepEqual(
      files.map((file) => again.readContent(file)),
      before,
    );
  });

  it('changes nothing on an app that runs on iOS and Android already', async () => {
    const phone = await workspace(runner, false);
    const files = [
      'projects/native/app.json',
      'projects/native/package.json',
      'package.json',
      'angular.json',
    ];
    const before = files.map((file) => phone.readContent(file));
    const again = await runner.runSchematic(
      'mobile',
      { project: 'native', skipInstall: true },
      phone,
    );
    assert.deepEqual(
      files.map((file) => again.readContent(file)),
      before,
    );
  });

  it('reads and keeps an angular.json with comments and trailing commas, as the Angular CLI does', async () => {
    const desktop = await workspace(runner, true);
    const text = desktop.readContent('angular.json');
    desktop.overwrite(
      'angular.json',
      text
        .replace('{', '{\n  // The web app and the native one.')
        .replace(/"architect": \{[\s\S]*?\n {6}\}/, `"architect": {},`),
    );
    const again = await runner.runSchematic(
      'mobile',
      { project: 'native', skipInstall: true },
      desktop,
    );
    const written = again.readContent('angular.json');
    assert.match(written, /\/\/ The web app and the native one\./);
    assert.match(written, /"command": "run:ios"/);
    assert.match(written, /"command": "run:android"/);
  });

  it('refuses a project with no app.json, and changes nothing', async () => {
    const withWeb = await angular.runSchematic(
      'application',
      { name: 'web', skipInstall: true },
      tree,
    );
    const files = ['angular.json', 'package.json'];
    const before = files.map((file) => withWeb.readContent(file));
    await assert.rejects(
      runner.runSchematic('mobile', { project: 'web', skipInstall: true }, withWeb),
      /web is not an Angular Native app: it has no projects\/web\/app\.json/,
    );
    assert.deepEqual(
      files.map((file) => withWeb.readContent(file)),
      before,
    );
  });

  it('refuses a project angular.json does not have', async () => {
    await assert.rejects(
      runner.runSchematic('mobile', { project: 'nope', skipInstall: true }, tree),
      /no project called "nope"/,
    );
  });
});
