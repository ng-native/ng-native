import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DESKTOP_OSES, desktopLinks, linkWarnings } from './autolink.mjs';

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

/** A library's config for Linux, or for both desktops when `macos` is given as well. */
const linuxConfig = (linux: object = { cmakeTarget: 'haptics_desktop' }, macos?: object) => ({
  platforms: ['apple', 'android', ...(macos ? ['macos'] : []), 'linux'],
  ...(macos && { macos }),
  linux,
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
      os: 'macos',
      libraries: [
        {
          name: 'rn-haptics',
          dir: path.join(root, 'node_modules/rn-haptics'),
          cmakeTarget: 'haptics_desktop',
          cmakeDir: path.join(root, 'node_modules/rn-haptics/desktop'),
        },
      ],
      appModules: [],
      hostLibraries: [],
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

  it("prefers the app's own version of a library to a nested one, whatever the order", () => {
    const direct = {
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
      }),
      'node_modules/kit/node_modules/rn-haptics/package.json': {
        name: 'rn-haptics',
        version: '0.1.0',
      },
    };
    for (const dependencies of [
      { kit: '1.0.0', 'rn-haptics': '1.0.0' },
      { 'rn-haptics': '1.0.0', kit: '1.0.0' },
    ]) {
      const root = app({
        'package.json': { dependencies },
        ...pkg('kit', {}, { 'rn-haptics': '0.1.0' }),
        ...direct,
      });
      assert.deepEqual(
        desktopLinks(root).libraries.map((library) => library.dir),
        [path.join(root, 'node_modules/rn-haptics')],
      );
    }
  });

  it('finds a library whose exports leave out package.json, and its dependencies', () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0' } },
      'node_modules/rn-haptics/package.json': {
        name: 'rn-haptics',
        version: '1.0.0',
        exports: { '.': './index.js' },
        dependencies: { 'rn-taptic': '1.0.0' },
      },
      'node_modules/rn-haptics/index.js': '',
      'node_modules/rn-haptics/expo-module.config.json': desktopConfig(),
      'node_modules/rn-haptics/desktop/CMakeLists.txt': '',
      'node_modules/rn-taptic/package.json': {
        name: 'rn-taptic',
        version: '1.0.0',
        exports: { '.': './index.js' },
      },
      'node_modules/rn-taptic/index.js': '',
      'node_modules/rn-taptic/ios/Taptic.m': '',
    });
    const links = desktopLinks(root);
    assert.deepEqual(
      links.libraries.map((library) => library.name),
      ['rn-haptics'],
    );
    assert.deepEqual(links.withoutDesktop, ['rn-taptic']);
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

  it('leaves out the libraries whose native modules the core answers, on both OSes', () => {
    // RNCAsyncStorage and RNAsyncStorage, and RNGestureHandlerModule, are core modules: the
    // library's JavaScript runs against them unchanged. A library the host does not answer is
    // still reported.
    const root = app({
      'package.json': {
        dependencies: {
          '@react-native-async-storage/async-storage': '2.2.0',
          'react-native-gesture-handler': '3.3.0',
          'react-native-keyboard-controller': '1.0.0',
        },
      },
      ...pkg('@react-native-async-storage/async-storage', {
        'ios/RNCAsyncStorage.mm': '',
        'RNCAsyncStorage.podspec': '',
      }),
      ...pkg('react-native-gesture-handler', {
        'android/build.gradle': '',
        'RNGestureHandler.podspec': '',
      }),
      ...pkg('react-native-keyboard-controller', { 'ios/KeyboardController.mm': '' }),
    });
    for (const os of DESKTOP_OSES) {
      const links = desktopLinks(root, { os });
      assert.deepEqual(links.withoutDesktop, ['react-native-keyboard-controller'], os);
      assert.deepEqual(links.libraries, [], os);
    }
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

  it('keeps a denied package out but still links what it depends on', () => {
    const root = app({
      'package.json': { dependencies: { kit: '1.0.0' } },
      ...pkg('kit', { 'ios/Kit.m': '' }, { 'rn-haptics': '1.0.0' }),
      ...pkg('rn-haptics', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
      }),
    });
    const links = desktopLinks(root, { deny: ['kit'] });
    assert.deepEqual(
      links.libraries.map((library) => library.name),
      ['rn-haptics'],
    );
    assert.deepEqual(links.withoutDesktop, []);
  });

  it('says where each host library it walks past is installed, nested ones too, but not denied ones', () => {
    const root = app({
      'package.json': { dependencies: { kit: '1.0.0', 'react-native-webview': '14.0.0' } },
      ...pkg('kit', {}, { 'react-native-svg': '15.0.0', 'react-native-screens': '4.0.0' }),
      'node_modules/kit/node_modules/react-native-svg/package.json': {
        name: 'react-native-svg',
        version: '15.0.0',
      },
      ...pkg('react-native-screens', { 'ios/RNS.mm': '' }),
      ...pkg('react-native-webview', { 'ios/W.m': '' }),
    });
    const links = desktopLinks(root, {
      deny: ['react-native-webview'],
      builtIn: ['react-native-screens', 'react-native-svg', 'react-native-webview'],
    });
    assert.deepEqual(links.hostLibraries, [
      { name: 'react-native-screens', dir: path.join(root, 'node_modules/react-native-screens') },
      {
        name: 'react-native-svg',
        dir: path.join(root, 'node_modules/kit/node_modules/react-native-svg'),
      },
    ]);
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

describe('DESKTOP_OSES', () => {
  it("is the desktop OSes of the device package's one OS list", () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../device/src/os.ts', import.meta.url)),
      'utf8',
    );
    const list = /OS_NAMES = \[(.*?)\] as const/.exec(source)?.[1] ?? '';
    const names = [...list.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    const desktop = /isDesktopOs = [^\n]*\n?[^\n;]*;/.exec(source)?.[0] ?? '';
    const desktopNames = names.filter((name) => desktop.includes(`'${name}'`));
    assert.deepEqual([...DESKTOP_OSES], desktopNames);
  });
});

describe('desktopLinks on Linux', () => {
  it('links a library whose expo-module.config.json lists linux, with its CMake target', () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0' } },
      ...pkg('rn-haptics', {
        'expo-module.config.json': linuxConfig({ cmakeTarget: 'haptics_linux', cmakeDir: 'gtk' }),
        'gtk/CMakeLists.txt': '',
      }),
    });
    const links = desktopLinks(root, { os: 'linux' });
    assert.equal(links.os, 'linux');
    assert.deepEqual(links.libraries, [
      {
        name: 'rn-haptics',
        dir: path.join(root, 'node_modules/rn-haptics'),
        cmakeTarget: 'haptics_linux',
        cmakeDir: path.join(root, 'node_modules/rn-haptics/gtk'),
      },
    ]);
    assert.deepEqual(links.withoutDesktop, []);
  });

  it("reads each OS's own entry from a library that lists both", () => {
    const root = app({
      'package.json': { dependencies: { 'rn-haptics': '1.0.0' } },
      ...pkg('rn-haptics', {
        'expo-module.config.json': linuxConfig(
          { cmakeTarget: 'haptics_linux', cmakeDir: 'linux' },
          { cmakeTarget: 'haptics_macos' },
        ),
        'linux/CMakeLists.txt': '',
        'desktop/CMakeLists.txt': '',
      }),
    });
    const targets = (os: 'macos' | 'linux') =>
      desktopLinks(root, { os }).libraries.map(({ cmakeTarget }) => cmakeTarget);
    assert.deepEqual(targets('macos'), ['haptics_macos']);
    assert.deepEqual(targets('linux'), ['haptics_linux']);
  });

  it('leaves a library with desktop code for the other OS out, and says it has none here', () => {
    const root = app({
      'package.json': { dependencies: { 'mac-only': '1.0.0', 'linux-only': '1.0.0' } },
      ...pkg('mac-only', {
        'expo-module.config.json': desktopConfig(),
        'desktop/CMakeLists.txt': '',
        'ios/Module.swift': '',
      }),
      ...pkg('linux-only', {
        'expo-module.config.json': linuxConfig(),
        'desktop/CMakeLists.txt': '',
        'ios/Module.swift': '',
      }),
    });
    const onLinux = desktopLinks(root, { os: 'linux' });
    assert.deepEqual(
      onLinux.libraries.map(({ name }) => name),
      ['linux-only'],
    );
    assert.deepEqual(onLinux.withoutDesktop, ['mac-only']);
    const onMac = desktopLinks(root);
    assert.deepEqual(
      onMac.libraries.map(({ name }) => name),
      ['mac-only'],
    );
    assert.deepEqual(onMac.withoutDesktop, ['linux-only']);
  });

  it('says a desktop-only library for the other OS has none here, with no mobile code to go by', () => {
    const root = app({
      'package.json': { dependencies: { 'mac-desktop': '1.0.0', 'linux-desktop': '1.0.0' } },
      ...pkg('mac-desktop', {
        'expo-module.config.json': { platforms: ['macos'], macos: { cmakeTarget: 'mac_desktop' } },
        'desktop/CMakeLists.txt': '',
      }),
      ...pkg('linux-desktop', {
        'expo-module.config.json': {
          platforms: ['linux'],
          linux: { cmakeTarget: 'linux_desktop' },
        },
        'desktop/CMakeLists.txt': '',
      }),
    });
    assert.deepEqual(desktopLinks(root, { os: 'linux' }).withoutDesktop, ['mac-desktop']);
    assert.deepEqual(desktopLinks(root).withoutDesktop, ['linux-desktop']);
  });

  it("compiles in the app's own modules/<name>/linux folders, not its macos ones", () => {
    const root = app({
      'package.json': {},
      'modules/clock/linux/CMakeLists.txt': '',
      'modules/clock/expo-module.config.json': {
        macos: { cmakeTarget: 'clock_macos' },
        linux: { cmakeTarget: 'clock_linux' },
      },
      'modules/ledger/linux/ledger.cpp': '',
      'modules/mac-only/macos/mac.mm': '',
    });
    assert.deepEqual(desktopLinks(root, { os: 'linux' }).appModules, [
      { name: 'clock', dir: path.join(root, 'modules/clock/linux'), cmakeTarget: 'clock_linux' },
      { name: 'ledger', dir: path.join(root, 'modules/ledger/linux'), cmakeTarget: null },
    ]);
    assert.deepEqual(
      desktopLinks(root).appModules.map(({ name }) => name),
      ['mac-only'],
    );
  });

  it('keeps a denied package out and the packages it depends on in', () => {
    const root = app({
      'package.json': { dependencies: { denied: '1.0.0' } },
      ...pkg('denied', { 'expo-module.config.json': linuxConfig() }, { inner: '1.0.0' }),
      ...pkg('inner', {
        'expo-module.config.json': linuxConfig({ cmakeTarget: 'inner' }),
        'desktop/CMakeLists.txt': '',
      }),
    });
    const links = desktopLinks(root, { os: 'linux', deny: ['denied'] });
    assert.deepEqual(
      links.libraries.map(({ name }) => name),
      ['inner'],
    );
  });

  it('names linux in why a library is left out', () => {
    const root = app({
      'package.json': { dependencies: { 'no-target': '1.0.0', 'no-cmake': '1.0.0' } },
      ...pkg('no-target', { 'expo-module.config.json': linuxConfig({}) }),
      ...pkg('no-cmake', { 'expo-module.config.json': linuxConfig() }),
    });
    const problems = desktopLinks(root, { os: 'linux' }).problems.join('\n');
    assert.match(problems, /no-target lists linux .* without a linux\.cmakeTarget/);
    assert.match(problems, /no-cmake names desktop\/CMakeLists\.txt for linux/);
  });

  it('refuses an OS it does not link for', () => {
    assert.throws(
      () => desktopLinks(app({ 'package.json': {} }), { os: 'ios' as never }),
      /Autolinking is for macos and linux, not 'ios'/,
    );
  });
});

describe('linkWarnings', () => {
  it('says Linux where the links are for it', () => {
    const [line] = linkWarnings({
      os: 'linux',
      libraries: [],
      appModules: [],
      hostLibraries: [],
      withoutDesktop: ['a'],
      problems: [],
    });
    assert.match(line!, /^No desktop code in a: their native modules are absent on Linux\./);
  });

  it('names the packages without desktop code and how to silence them', () => {
    const lines = linkWarnings({
      os: 'macos',
      libraries: [],
      appModules: [],
      hostLibraries: [],
      withoutDesktop: ['a', 'b'],
      problems: ['p'],
    });
    assert.equal(lines[0], 'p');
    assert.match(lines[1]!, /^No desktop code in a, b: their native modules are absent on macOS\./);
    assert.match(lines[1]!, /deny option of the @ng-native\/desktop plugin/);
    assert.deepEqual(
      linkWarnings({
        os: 'macos',
        libraries: [],
        appModules: [],
        hostLibraries: [],
        withoutDesktop: [],
        problems: [],
      }),
      [],
    );
  });
});
