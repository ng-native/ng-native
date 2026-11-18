/**
 * `npx expo export -p linux`, in release and in dev, of an app whose Metro config is the preset and
 * whose `app.config.js` calls `registerLinux`, which `expo export` needs before it loads Metro.
 *
 * Expo SDK 58 does not know `linux`; once registered, a `linux` bundle takes React Native's iOS
 * files as a `macos` one does. Each bundle is run in a bare V8 context with no `Intl`, as the Linux
 * host's Hermes is built, and a recording stand-in for the native modules, so what is checked is
 * what the code does.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');

const ENTRY = `import 'expo';
import { Alert, Platform } from 'react-native';
import crypto from 'expo-crypto';
import { picked as linux } from './linux-first';
import { picked as ios } from './ios-before-native';

globalThis.__probe = {
  os: Platform.OS,
  select: Platform.select({ ios: 1 }),
  selectLinux: Platform.select({ linux: 5, macos: 4, ios: 1 }),
  selectMacos: Platform.select({ macos: 4, ios: 1 }),
  chain: [linux, ios],
  emptied: Object.keys(crypto ?? {}).length,
  alert: (title, message) => Alert.alert(title, message),
  url: () => new URL('https://example.com/a?b=c').searchParams.get('b'),
  number: () => new Intl.NumberFormat('en-US').format(1234.5),
  plural: () => new Intl.PluralRules('en').select(1),
  list: () => new Intl.ListFormat('en').format(['a', 'b']),
  date: () => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric' }).format(0),
  zone: () => new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone,
};
`;

const FILES: Record<string, string> = {
  'package.json': '{ "name": "linux-export", "private": true, "main": "index.js" }',
  'app.json': JSON.stringify({
    expo: {
      name: 'linux-export',
      slug: 'linux-export',
      platforms: ['linux'],
      experiments: { outOfTreePlatforms: true },
    },
  }),
  'app.config.js': `require('@ng-native/metro/linux.cjs').registerLinux(__dirname);
module.exports = ({ config }) => config;
`,
  'metro.config.js': `const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
module.exports = withAngularNative(getDefaultConfig(__dirname));
`,
  'index.js': ENTRY,
  'linux-first.linux.js': "export const picked = 'linux';",
  'linux-first.ios.js': "export const picked = 'ios';",
  'linux-first.js': "export const picked = 'plain';",
  'ios-before-native.ios.js': "export const picked = 'ios';",
  'ios-before-native.native.js': "export const picked = 'native';",
  'ios-before-native.js': "export const picked = 'plain';",
};

interface Probe {
  os: string;
  select: unknown;
  selectLinux: unknown;
  selectMacos: unknown;
  chain: string[];
  emptied: number;
  alert(title: string, message: string): void;
  url(): string;
  number(): string;
  plural(): string;
  list(): string;
  date(): string;
  zone(): string;
}

// Real, because Metro watches the project under the path it is given and macOS links the temp
// directory from somewhere else.
let root = '';
before(() => {
  root = mkdtempSync(path.join(realpathSync(tmpdir()), 'linux-export-'));
  for (const [name, text] of Object.entries(FILES)) writeFileSync(path.join(root, name), text);
  // This package's own dependencies, as the app's: expo, react-native and @ng-native/metro.
  symlinkSync(path.join(import.meta.dirname, 'node_modules'), path.join(root, 'node_modules'));
});
after(() => rmSync(root, { recursive: true, force: true }));

/** The bundle `expo export -p linux` writes, as JavaScript rather than Hermes bytecode. */
function exportLinux(mode: 'dev' | 'release'): string {
  const out = path.join(root, `out-${mode}`);
  execFileSync(
    process.execPath,
    [
      expoCli,
      'export',
      '--platform',
      'linux',
      '--output-dir',
      out,
      '--no-bytecode',
      ...(mode === 'dev' ? ['--dev'] : []),
    ],
    { cwd: root, stdio: 'pipe', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } },
  );
  const dir = path.join(out, '_expo/static/js/linux');
  const [bundle] = readdirSync(dir).filter((name) => name.endsWith('.js'));
  assert.ok(bundle, `no linux bundle in ${dir}`);
  return readFileSync(path.join(dir, bundle), 'utf8');
}

/**
 * Runs the app's own module and nothing Metro runs before it (React Native's setup, which needs a
 * device), with no `Intl`, and answers every native module with a recorder.
 */
function run(bundle: string): { probe: Probe; calls: string[] } {
  const lines = bundle.split('\n');
  const starts = lines.filter((line) => /^__r\(\d+\);$/.test(line));
  const entry = starts.at(-1);
  assert.ok(entry, 'the bundle starts no module');
  const code =
    'delete globalThis.Intl;\n' +
    lines.filter((line) => !/^__r\(\d+\);$/.test(line)).join('\n') +
    `\n${entry}`;
  const calls: string[] = [];
  const constants = {
    osVersion: '6.8',
    interfaceIdiom: 'pad',
    reactNativeVersion: { major: 0, minor: 88, patch: 0 },
    Dimensions: {
      window: { width: 800, height: 600, scale: 1, fontScale: 1 },
      screen: { width: 1920, height: 1080, scale: 1, fontScale: 1 },
    },
  };
  // What Hermes has built in and a bare V8 context does not.
  const context: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    Headers,
    ReadableStream,
    __fbBatchedBridgeConfig: { remoteModuleConfig: [] },
    __turboModuleProxy: (name: string) =>
      new Proxy(
        {},
        {
          get: (_, method) =>
            method === 'getConstants'
              ? () => constants
              : name === 'NgNativeLocalization' && method === 'getCalendars'
                ? () => [{ timeZone: 'Europe/Berlin' }]
                : () => void calls.push(`${name}.${String(method)}`),
        },
      ),
  };
  context['global'] = context;
  context['globalThis'] = context;
  vm.runInNewContext(code, context);
  return { probe: context['__probe'] as Probe, calls };
}

for (const mode of ['release', 'dev'] as const) {
  describe(`expo export -p linux, ${mode}`, () => {
    let app: { probe: Probe; calls: string[] };
    before(() => {
      app = run(exportLinux(mode));
    });

    it("shows the app Platform.OS as 'linux'", () => {
      assert.equal(app.probe.os, 'linux');
    });

    it('answers Platform.select from linux, then ios, and never from macos', () => {
      assert.equal(app.probe.select, 1);
      assert.equal(app.probe.selectLinux, 5);
      assert.equal(app.probe.selectMacos, 1);
    });

    it("keeps Alert.alert's iOS body, so it reaches the alert module", () => {
      app.probe.alert('Title', 'Message');
      assert.deepEqual(app.calls, ['AlertManager.alertWithArgs']);
    });

    it('resolves a file .linux first, then .ios', () => {
      assert.deepEqual([...app.probe.chain], ['linux', 'ios']);
    });

    it('empties every expo- package, and gives expo its runtime', () => {
      assert.equal(app.probe.emptied, 0);
      assert.equal(app.probe.url(), 'c');
    });

    it('installs Intl where the engine has none, with English data', () => {
      assert.equal(app.probe.number(), '1,234.5');
      assert.equal(app.probe.plural(), 'one');
      assert.equal(app.probe.list(), 'a and b');
      assert.equal(app.probe.date(), '1970');
    });

    it("sets Intl's time zone to the one the desktop host's localization module reports", () => {
      assert.equal(app.probe.zone(), 'Europe/Berlin');
    });
  });
}
