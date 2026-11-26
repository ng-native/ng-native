/**
 * `@ng-native/template-desktop`, the starter for a macOS and Linux app, is the mobile template with
 * the phone left out. The files they share stay identical, so a fix to one reaches both, and its
 * config is what `ng-native-desktop` needs: macOS and Linux listed, with Expo's out-of-tree
 * platforms flag, and the desktop config plugin.
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
    assert.match(agents(desktop), /^npm run linux /m);
  });

  it('lists macOS and Linux alone, with the out-of-tree platforms flag and the desktop plugin', () => {
    const { expo } = json(desktop, 'app.json');
    assert.deepEqual(expo.platforms, ['macos', 'linux']);
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
      'linux',
      'macos',
      'package',
      'start',
      'test',
      'typecheck',
    ]);
    assert.equal(scripts.macos, 'ng-native-desktop run');
    assert.equal(scripts.linux, 'ng-native-desktop run --os linux');
    assert.equal(scripts.package, 'ng-native-desktop package');
    for (const name of ['start', 'typecheck']) assert.equal(scripts[name], theirs[name]);
    // Its Vitest config has projects that open the app, so `npm test` names the Node ones.
    assert.equal(scripts.test, 'vitest run --project node-macos --project node-linux');
  });

  it('tests in Node as each OS, and inside the app with `vitest --project macos` and `linux`', () => {
    const config = read(desktop, 'vitest.config.mts').toString('utf8');
    for (const os of ['macos', 'linux']) {
      assert.match(
        config,
        new RegExp(`ngNative\\(\\{ os: '${os}' \\}\\)\\], test: \\{ name: 'node-${os}' \\}`),
        os,
      );
    }
    assert.match(config, /deviceTests\(\{ platform: 'macos' \}\)/);
    assert.match(config, /deviceTests\(\{ platform: 'linux' \}\)/);
    const readme = read(desktop, 'README.md').toString('utf8');
    assert.match(readme, /vitest --project macos/);
    assert.match(readme, /vitest --project linux/);
    assert.match(read(desktop, 'AGENTS.md').toString('utf8'), /vitest --project linux/);
    assert.match(readme, /npm run linux/);
    assert.match(readme, /`node-macos` and `node-linux`/);
    // The project starts Metro for the tests itself: nothing to start in another terminal.
    assert.match(readme, /starts\s+Metro and opens the app itself/);
    assert.doesNotMatch(readme, /EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start/);
  });

  it("wraps Metro's config for the in-app tests, and starts the test host for them in main.ts", () => {
    assert.match(
      read(desktop, 'metro.config.js').toString('utf8'),
      /withDeviceTests\(withAngularNative\(/,
    );
    const main = read(desktop, 'src/main.ts').toString('utf8');
    assert.match(main, /if \(process\.env\.EXPO_PUBLIC_DEVICE_TESTS\) \{/);
    assert.match(
      main,
      /startDeviceTests\(\{\s*mount: mountOptions,\s*\/\/[^\n]*\n\s*onMount: \(app\) => \{\s*const stopWatching = watchConditions\(app\.engine\);\s*app\.applicationRef\.onDestroy\(stopWatching\);/,
    );
    // The mobile template's app mounts the same options, so the two stay alike where they can.
    assert.match(main, /AppRegistry\.registerRunnable\('main'/);
  });

  it("passes package's flags after --, which npm otherwise takes as its own and drops", () => {
    for (const file of ['README.md', 'AGENTS.md']) {
      const text = read(desktop, file).toString('utf8');
      assert.match(text, /npm run package -- --format dmg/, file);
      assert.doesNotMatch(text, /npm run package +#[^\n]*--format/, file);
    }
  });

  it('has an in-app test beside the Node one', () => {
    const test = read(desktop, 'src/app/app.device.ts').toString('utf8');
    // Passes on each host a project runs it on: both desktops, and iOS or Android once added.
    assert.match(test, /\['macos', 'linux', 'ios', 'android'\]\)\.toContain\(Platform\.OS\)/);
  });

  it('sizes its starter screen for a desktop on Linux as on macOS', () => {
    const app = read(desktop, 'src/app/app.ts').toString('utf8');
    for (const part of ['content', 'title', 'hint']) {
      assert.match(app, new RegExp(`:host-context\\(\\.platform-linux\\) \\.${part}`), part);
    }
  });

  it("takes the mobile template's version of every dependency they share", () => {
    const ours = json(desktop, 'package.json');
    const theirs = json(mobile, 'package.json');
    assert.equal(ours.version, theirs.version);
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(ours[field])) {
        if (!(name in theirs[field])) continue;
        // A host library is pinned to the exact version the prebuilt desktop host is built with,
        // inside the mobile template's range.
        const pinned = name === 'react-native-safe-area-context';
        assert.equal(
          range,
          pinned ? theirs[field][name].replace(/^~/, '') : theirs[field][name],
          name,
        );
      }
    }
    assert.equal(ours.dependencies['@ng-native/desktop'], 'workspace:*');
    for (const phone of ['expo-status-bar', 'expo-system-ui']) {
      assert.equal(ours.dependencies[phone], undefined, phone);
    }
  });
});
