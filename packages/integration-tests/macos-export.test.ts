/**
 * `npx expo export -p macos`, in release and in dev, of an app whose Metro config is the preset.
 *
 * Expo SDK 58 bundles `macos` with React Native's iOS files, and its release build inlines
 * `Platform.OS` as `'macos'` before anything else sees it, so React Native's own iOS branches were
 * deleted as dead code: `Alert.alert` shipped with an empty body, and `Platform.select({ ios })`
 * came out `undefined`. In dev the same app saw `Platform.OS` as `'ios'`.
 *
 * Each bundle is run in a bare V8 context with a recording stand-in for the native modules, so
 * what is checked is what the code does, not what its text looks like.
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
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');

const ENTRY = `import 'expo';
import { Alert, Platform } from 'react-native';
import resolveAssetSource from 'react-native/Libraries/Image/resolveAssetSource';
import crypto from 'expo-crypto';
import { picked as macos } from './macos-first';
import { picked as ios } from './ios-before-native';
import { picked as native } from './native-before-plain';

globalThis.__probe = {
  os: Platform.OS,
  select: Platform.select({ ios: 1 }),
  selectNative: Platform.select({ native: 2, default: 3 }),
  selectMacos: Platform.select({ macos: 4, ios: 1 }),
  chain: [macos, ios, native],
  emptied: Object.keys(crypto ?? {}).length,
  alert: (title, message) => Alert.alert(title, message),
  url: () => new URL('https://example.com/a?b=c').searchParams.get('b'),
  clone: () => structuredClone({ a: [1] }).a[0],
  fetch: () => void fetch('https://example.com/a'),
  image: () => resolveAssetSource(require('./logo.png')).uri,
};
`;

/** A 1x1 PNG, for an asset the bundle registers. */
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const LOGO_HASH = createHash('md5').update(LOGO).digest('hex');
/** Where the desktop host answers an Expo update keeps the logo, by its file hash. */
const UPDATE_LOGO = `file:///updates/2a1b/assets/${LOGO_HASH}.png`;

const FILES: Record<string, string> = {
  'package.json': '{ "name": "macos-export", "private": true, "main": "index.js" }',
  'app.json': JSON.stringify({
    expo: {
      name: 'macos-export',
      slug: 'macos-export',
      platforms: ['macos'],
      experiments: { outOfTreePlatforms: true },
    },
  }),
  'metro.config.js': `const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
module.exports = withAngularNative(getDefaultConfig(__dirname));
`,
  'index.js': ENTRY,
  'macos-first.macos.js': "export const picked = 'macos';",
  'macos-first.ios.js': "export const picked = 'ios';",
  'macos-first.js': "export const picked = 'plain';",
  'ios-before-native.ios.js': "export const picked = 'ios';",
  'ios-before-native.native.js': "export const picked = 'native';",
  'ios-before-native.js': "export const picked = 'plain';",
  'native-before-plain.native.js': "export const picked = 'native';",
  'native-before-plain.js': "export const picked = 'plain';",
};

interface Probe {
  os: string;
  select: unknown;
  selectNative: unknown;
  selectMacos: unknown;
  chain: string[];
  emptied: number;
  alert(title: string, message: string): void;
  url(): string;
  clone(): number;
  fetch(): void;
  image(): string;
}

// Real, because Metro watches the project under the path it is given and macOS links the temp
// directory from somewhere else.
let root = '';
before(() => {
  root = mkdtempSync(path.join(realpathSync(tmpdir()), 'macos-export-'));
  for (const [name, text] of Object.entries(FILES)) writeFileSync(path.join(root, name), text);
  writeFileSync(path.join(root, 'logo.png'), LOGO);
  // This package's own dependencies, as the app's: expo, react-native and @ng-native/metro.
  symlinkSync(path.join(import.meta.dirname, 'node_modules'), path.join(root, 'node_modules'));
});
after(() => rmSync(root, { recursive: true, force: true }));

/** The bundle `expo export -p macos` writes, as JavaScript rather than Hermes bytecode. */
function exportMacos(mode: 'dev' | 'release'): string {
  const out = path.join(root, `out-${mode}`);
  execFileSync(
    process.execPath,
    [
      expoCli,
      'export',
      '--platform',
      'macos',
      '--output-dir',
      out,
      '--no-bytecode',
      ...(mode === 'dev' ? ['--dev'] : []),
    ],
    { cwd: root, stdio: 'pipe', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } },
  );
  const dir = path.join(out, '_expo/static/js/macos');
  const [bundle] = readdirSync(dir).filter((name) => name.endsWith('.js'));
  assert.ok(bundle, `no macos bundle in ${dir}`);
  return readFileSync(path.join(dir, bundle), 'utf8');
}

/**
 * Runs the app's own module and nothing Metro runs before it (React Native's setup, which needs
 * a device), and answers every native module with a recorder.
 */
function run(
  bundle: string,
  localAssets: Record<string, string> = {},
): { probe: Probe; calls: string[] } {
  const lines = bundle.split('\n');
  const starts = lines.filter((line) => /^__r\(\d+\);$/.test(line));
  const entry = starts.at(-1);
  assert.ok(entry, 'the bundle starts no module');
  const code = lines.filter((line) => !/^__r\(\d+\);$/.test(line)).join('\n') + `\n${entry}`;
  const calls: string[] = [];
  const constants = {
    osVersion: '26.0',
    interfaceIdiom: 'mac',
    reactNativeVersion: { major: 0, minor: 88, patch: 0 },
    Dimensions: {
      window: { width: 800, height: 600, scale: 2, fontScale: 1 },
      screen: { width: 1440, height: 900, scale: 2, fontScale: 1 },
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
            name === 'NgNativeUpdates' && method === 'localAssets'
              ? localAssets
              : method === 'getConstants'
                ? () => constants
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
  describe(`expo export -p macos, ${mode}`, () => {
    let app: { probe: Probe; calls: string[] };
    let updated: { probe: Probe; calls: string[] };
    before(() => {
      const bundle = exportMacos(mode);
      app = run(bundle);
      updated = run(bundle, { [LOGO_HASH]: UPDATE_LOGO });
    });

    it("shows the app Platform.OS as 'macos'", () => {
      assert.equal(app.probe.os, 'macos');
    });

    it('answers Platform.select from macos, then ios, then native, then default', () => {
      assert.equal(app.probe.select, 1);
      assert.equal(app.probe.selectMacos, 4);
      assert.equal(app.probe.selectNative, 2);
    });

    it("keeps Alert.alert's iOS body, so it reaches the alert module", () => {
      app.probe.alert('Title', 'Message');
      assert.deepEqual(app.calls, ['AlertManager.alertWithArgs']);
    });

    it('resolves a file .macos first, then .ios, then .native', () => {
      assert.deepEqual([...app.probe.chain], ['macos', 'ios', 'native']);
    });

    it("resolves an image from the running update's assets by its file hash, else beside the bundle", () => {
      assert.equal(updated.probe.image(), UPDATE_LOGO);
      assert.match(app.probe.image(), /\/logo\.png$/);
    });

    it('empties every expo- package, and gives expo its runtime', () => {
      assert.equal(app.probe.emptied, 0);
      assert.equal(app.probe.url(), 'c');
      assert.equal(app.probe.clone(), 1);
    });

    it("gives fetch the streaming one, over React Native's Networking module", () => {
      app.probe.fetch();
      assert.ok(app.calls.includes('Networking.sendRequest'), app.calls.join(', '));
    });
  });
}
