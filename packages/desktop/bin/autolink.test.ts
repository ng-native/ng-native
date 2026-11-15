import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { desktopLinks, linkWarnings } from './autolink.mjs';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Files = Record<string, string | object>;

/** An app directory with these files in it, each a string or JSON. */
function app(files: Files): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-autolink-')));
  made.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return root;
}

/** A package in the app's node_modules, with its package.json and these files. */
function pkg(name: string, files: Files = {}, dependencies: Record<string, string> = {}): Files {
  const at = (file: string) => `node_modules/${name}/${file}`;
  return {
    [at('package.json')]: { name, version: '1.0.0', dependencies },
    ...Object.fromEntries(Object.entries(files).map(([file, content]) => [at(file), content])),
  };
}

const desktopConfig = (macos: object = { cmakeTarget: 'haptics_desktop' }) => ({
  platforms: ['apple', 'android', 'macos'],
  macos,
});

describe('desktopLinks', () => {
  it('links a library whose expo-module.config.json lists macos, with its CMake target', () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0' } },
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
      }),
    });
    assert.deepEqual(desktopLinks(root), {
      libraries: [
        {
          name: 'rn-haptics',
          dir: path.join(root, 'node_modules/rn-haptics'),
          cmakeTarget: 'haptics_desktop',
          cmakeDir: path.join(root, 'node_modules/rn-haptics/desktop'),
        },
      ],
      appModules: [],
      withoutDesktop: [],
      problems: [],
    });
  });

  it('takes the folder a library names for its CMake fragment', () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0' } },
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig({ cmakeTarget: 't', cmakeDir: 'cpp/desktop' }),
        'cpp/desktop/CMakeLists.txt': '',
      }),
    });
    assert.equal(
      desktopLinks(root).libraries[0]?.cmakeDir,
      path.join(root, 'node_modules/rn-haptics/cpp/desktop'),
    );
  });

  it('finds a library a dependency depends on, as Expo autolinking does, once', () => {
    const root = app({
      'package.json': { dependencies: { kit: '1.0.0', 'rn-haptics': '1.0.0' } },
      ...pkg('kit', {}, { 'rn-haptics': '1.0.0' }),
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
      }),
    });
    assert.deepEqual(
      desktopLinks(root).libraries.map((library) => library.name),
      ['rn-haptics'],
    );
  });

  it("compiles in the app's own modules/<name>/macos folders, with a target where one is named", () => {
    const root = app({
      'package.json': {},
      'modules/clock/macos/CMakeLists.txt': '',
      'modules/clock/expo-module.config.json': desktopConfig({ cmakeTarget: 'clock_desktop' }),
      'modules/ledger/macos/CMakeLists.txt': '',
      'modules/phone-only/ios/Module.swift': '',
    });
    assert.deepEqual(desktopLinks(root).appModules, [
      { name: 'clock', dir: path.join(root, 'modules/clock/macos'), cmakeTarget: 'clock_desktop' },
      { name: 'ledger', dir: path.join(root, 'modules/ledger/macos'), cmakeTarget: null },
    ]);
  });

  it('lists the dependencies with native code and no desktop code, and only those', () => {
    const root = app({
      'package.json': {
        dependencies: {
          'with-ios': '1.0.0',
          'with-podspec': '1.0.0',
          'with-codegen': '1.0.0',
          'phone-module': '1.0.0',
          'plain-js': '1.0.0',
          'react-native': '0.88.0',
          'expo-haptics': '1.0.0',
          '@ng-native/expo': '1.0.0',
        },
      },
      ...pkg('with-ios', { 'ios/Thing.m': '' }),
      ...pkg('with-podspec', { 'WithPodspec.podspec': '' }),
      ...pkg('phone-module', { 'expo-module.config.json': { platforms: ['apple', 'android'] } }),
      ...pkg('plain-js', { 'index.js': '' }),
      ...pkg('react-native', { 'ios/RN.m': '' }),
      ...pkg('expo-haptics', { 'ios/H.swift': '' }),
      ...pkg('@ng-native/expo', { 'ios/X.swift': '' }),
      'node_modules/with-codegen/package.json': {
        name: 'with-codegen',
        codegenConfig: { name: 'WithCodegen' },
      },
    });
    assert.deepEqual(desktopLinks(root).withoutDesktop, [
      'phone-module',
      'with-codegen',
      'with-ios',
      'with-podspec',
    ]);
  });

  it('keeps a denied package out of the build and out of the warning', () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0', 'with-ios': '1.0.0' } },
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
      }),
      ...pkg('with-ios', { 'ios/Thing.m': '' }),
    });
    const links = desktopLinks(root, { deny: ['rn-haptics', 'with-ios'] });
    assert.deepEqual(links.libraries, []);
    assert.deepEqual(links.withoutDesktop, []);
  });

  it('leaves the libraries the host compiles in itself unreported', () => {
    const root = app({
      'package.json': { dependencies: { 'react-native-screens': '4.0.0' } },
      ...pkg('react-native-screens', { 'ios/RNS.mm': '' }),
    });
    const links = desktopLinks(root, { builtIn: ['react-native-screens'] });
    assert.deepEqual(links.withoutDesktop, []);
    assert.deepEqual(links.libraries, []);
  });

  it('says why a library that lists macos is left out, with no target or no CMake fragment', () => {
    const root = app({
      'package.json': { dependencies: { 'no-target': '1.0.0', 'no-cmake': '1.0.0' } },
      ...pkg('no-target', { 'expo-module.config.json': desktopConfig({}) }),
      ...pkg('no-cmake', { 'expo-module.config.json': desktopConfig() }),
    });
    const links = desktopLinks(root);
    assert.deepEqual(links.libraries, []);
    assert.equal(links.problems.length, 2);
    assert.match(
      links.problems.join('\n'),
      /no-target lists macos .* without a macos\.cmakeTarget/,
    );
    assert.match(links.problems.join('\n'), /no-cmake names desktop\/CMakeLists\.txt for macos/);
  });

  it('skips a dependency that is not installed', () => {
    const root = app({ 'package.json': { dependencies: { missing: '1.0.0' } } });
    assert.deepEqual(desktopLinks(root).withoutDesktop, []);
  });
});

describe('linkWarnings', () => {
  it('names the packages without desktop code and how to silence them', () => {
    const lines = linkWarnings({
      libraries: [],
      appModules: [],
      withoutDesktop: ['a', 'b'],
      problems: ['p'],
    });
    assert.equal(lines[0], 'p');
    assert.match(lines[1]!, /^No desktop code in a, b: their native modules are absent on macOS\./);
    assert.match(lines[1]!, /deny option of the @ng-native\/desktop plugin/);
    assert.deepEqual(
      linkWarnings({ libraries: [], appModules: [], withoutDesktop: [], problems: [] }),
      [],
    );
  });
});
