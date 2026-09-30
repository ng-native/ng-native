/**
 * The generated app is the template's app.
 *
 * `template/` is what this project verifies before every release, by publishing it and bundling an
 * app made from it. These tests are what extend that to the schematics: a file here that differs
 * from the template's, or a version that does, is an app nobody has verified.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const native = require('./native-app.cjs');

const template = path.resolve(import.meta.dirname, '../../template');
const manifest = JSON.parse(readFileSync(path.join(template, 'package.json'), 'utf8'));

describe('the generated app', () => {
  for (const file of native.SOURCE_FILES) {
    it(`copies the template's ${file} as it is`, () => {
      assert.equal(native.sourceFile(file), readFileSync(path.join(template, file), 'utf8'));
    });
  }

  it("gives the app the template's AGENTS.md, with its own commands in place of npm's", () => {
    const agents = native.agentsFile('COMMANDS');
    const theirs = readFileSync(path.join(template, 'AGENTS.md'), 'utf8');
    assert.equal(native.sourceFile('AGENTS.md'), theirs);
    const around = (text: string) => [
      text.slice(0, text.indexOf('## Commands')),
      text.slice(text.indexOf('## Rules')),
    ];
    assert.deepEqual(around(agents), around(theirs));
    assert.match(agents, /## Commands\n\nCOMMANDS\n\n## Rules/);
  });

  it("installs the template's dependencies, at the template's versions", () => {
    assert.deepEqual(
      Object.keys(native.dependencies).sort(),
      Object.keys(manifest.dependencies).sort(),
    );
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      if (range === 'workspace:*') continue;
      assert.equal(native.dependencies[name], range, name);
    }
  });

  it("installs the template's dev dependencies, at the template's versions", () => {
    assert.deepEqual(
      Object.keys(native.devDependencies).sort(),
      Object.keys(manifest.devDependencies).sort(),
    );
    for (const [name, range] of Object.entries(manifest.devDependencies)) {
      if (range === 'workspace:*') continue;
      assert.equal(native.devDependencies[name], range, name);
    }
  });

  it("ignores what the template's gitignore does in the app's own directory", () => {
    const ignored = (text: string) =>
      text.split('\n').filter((line: string) => line && !line.startsWith('#'));
    const theirs = ignored(readFileSync(path.join(template, 'gitignore'), 'utf8'));
    for (const line of ignored(native.GITIGNORE)) assert.ok(theirs.includes(line), line);
    assert.deepEqual(ignored(native.GITIGNORE), ['/ios', '/android', '.angular-native/']);
  });

  it('pins the framework packages to its own version, since they are released together', () => {
    const { version } = require('./package.json');
    assert.equal(native.dependencies['@ng-native/platform'], version);
    assert.equal(native.devDependencies['@ng-native/testing'], version);
  });

  it("names app.json for the project, keeping the template's settings", () => {
    const { expo } = JSON.parse(native.appJson('field-notes'));
    const theirs = JSON.parse(readFileSync(path.join(template, 'app.json'), 'utf8')).expo;
    assert.equal(expo.name, 'field-notes');
    assert.equal(expo.slug, 'field-notes');
    assert.equal(expo.scheme, 'fieldnotes');
    for (const key of ['orientation', 'userInterfaceStyle', 'version', 'platforms', 'extra']) {
      assert.deepEqual(expo[key], theirs[key], key);
    }
    assert.equal(expo.android.predictiveBackGestureEnabled, false);
  });
});

describe('conflicts', () => {
  it("says nothing about the workspace's own pins of the framework packages", () => {
    const workspace = { dependencies: { '@ng-native/platform': '0.0.1' } };
    assert.deepEqual(native.conflicts(workspace), []);
  });

  it('says nothing about a workspace whose ranges can resolve to what the app needs', () => {
    const workspace = {
      dependencies: { '@angular/core': '^22.2.0', react: '^19.2.0' },
      devDependencies: { typescript: '~6.0.2', vitest: '^5.0.0' },
    };
    assert.deepEqual(native.conflicts(workspace), []);
  });

  it('names an Angular pinned below the one the framework is built against', () => {
    const [problem] = native.conflicts({ dependencies: { '@angular/core': '21.2.0' } });
    assert.match(problem, /@angular\/core is 21\.2\.0 here, and Angular Native needs \^22\.0\.0/);
  });

  it("accepts the Vitest range @ng-native/testing's plugin does, and names one older", () => {
    const testing = JSON.parse(
      readFileSync(new URL('../testing/package.json', import.meta.url), 'utf8'),
    );
    assert.equal(native.accepted.vitest, testing.peerDependencies.vitest);
    assert.deepEqual(native.conflicts({ devDependencies: { vitest: '~4.1.0' } }), []);
    const [problem] = native.conflicts({ devDependencies: { vitest: '^3.2.0' } });
    assert.match(
      problem,
      /vitest is \^3\.2\.0 here, and Angular Native needs \^4\.0\.8 \|\| \^5\.0\.0/,
    );
  });

  it('ignores a range it cannot read, such as a workspace or file link', () => {
    assert.deepEqual(native.conflicts({ dependencies: { react: 'workspace:*' } }), []);
  });
});

describe('the project package.json', () => {
  it('lists every dependency the app has, at the ranges the workspace root installs', () => {
    // Expo links the native modules this file names and no others, so a module left out of it
    // is missing from the build: RNCSafeAreaView crashed on Android and was blank on iOS.
    const root = { dependencies: { react: '^19.2.3', expo: '~57.0.24', 'react-native': '0.86.3' } };
    const listed = native.projectManifest('native', root).dependencies;
    assert.deepEqual(Object.keys(listed).sort(), Object.keys(native.dependencies).sort());
    assert.equal(listed.expo, '~57.0.24');
    assert.equal(listed.react, '^19.2.3');
    assert.equal(
      listed['react-native-safe-area-context'],
      native.dependencies['react-native-safe-area-context'],
    );
  });
});
