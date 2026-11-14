/**
 * `@ng-native/template-desktop`, the starter for a macOS-only app, is the mobile template with the
 * phone left out. The files they share stay identical, so a fix to one reaches both, and its
 * config is what `ng-native-desktop` needs: macOS listed, with Expo's out-of-tree platforms flag,
 * and the desktop config plugin.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('../../template/', import.meta.url));
const desktop = fileURLToPath(new URL('../../template-desktop/', import.meta.url));
const read = (root: string, file: string) => readFileSync(`${root}${file}`);
const json = (root: string, file: string) => JSON.parse(read(root, file).toString('utf8'));

const SHARED = [
  '.npmignore',
  'CLAUDE.md',
  'LICENSE',
  'gitignore',
  'metro.config.js',
  'tsconfig.json',
  'vitest.config.mts',
  'src/main.ts',
  'assets/icon.png',
];

describe('the desktop template', () => {
  for (const file of SHARED) {
    it(`shares the mobile template's ${file}`, () => {
      assert.ok(read(desktop, file).equals(read(mobile, file)), file);
    });
  }

  it("shares the mobile template's AGENTS.md, but for what the app is and how it runs", () => {
    const outside = (text: string) => [
      text.slice(text.indexOf('The whole documentation'), text.indexOf('## Commands')),
      text.slice(text.indexOf('## Rules')),
    ];
    const agents = (root: string) => read(root, 'AGENTS.md').toString('utf8');
    assert.deepEqual(outside(agents(desktop)), outside(agents(mobile)));
    assert.match(agents(desktop), /^npm run macos /m);
  });

  it('lists macOS alone, with the out-of-tree platforms flag and the desktop plugin', () => {
    const { expo } = json(desktop, 'app.json');
    assert.deepEqual(expo.platforms, ['macos']);
    assert.deepEqual(expo.experiments, { outOfTreePlatforms: true });
    assert.deepEqual(expo.plugins, ['@ng-native/metro', '@ng-native/desktop']);
    for (const key of ['ios', 'android', 'orientation']) assert.equal(expo[key], undefined, key);
    const theirs = json(mobile, 'app.json').expo;
    for (const key of ['version', 'icon', 'userInterfaceStyle', 'scheme', 'extra']) {
      assert.deepEqual(expo[key], theirs[key], key);
    }
  });

  it('runs and packages the app with ng-native-desktop, and tests and typechecks as mobile does', () => {
    const { scripts } = json(desktop, 'package.json');
    const theirs = json(mobile, 'package.json').scripts;
    assert.deepEqual(Object.keys(scripts).sort(), [
      'macos',
      'package',
      'start',
      'test',
      'typecheck',
    ]);
    assert.equal(scripts.macos, 'ng-native-desktop run');
    assert.equal(scripts.package, 'ng-native-desktop package');
    for (const name of ['start', 'test', 'typecheck']) assert.equal(scripts[name], theirs[name]);
  });

  it("takes the mobile template's version of every dependency they share", () => {
    const ours = json(desktop, 'package.json');
    const theirs = json(mobile, 'package.json');
    assert.equal(ours.version, theirs.version);
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(ours[field])) {
        if (name in theirs[field]) assert.equal(range, theirs[field][name], name);
      }
    }
    assert.equal(ours.dependencies['@ng-native/desktop'], 'workspace:*');
    for (const phone of ['expo-status-bar', 'expo-system-ui']) {
      assert.equal(ours.dependencies[phone], undefined, phone);
    }
  });
});
