import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  cacheDir,
  checkExpoConfig,
  devServerBundleUrl,
  HOST_LIBRARIES,
  linkFile,
  main,
  parseCommand,
  run,
  system,
  UsageError,
} from './cli.mjs';
import { prepareHost } from './host.mjs';
import { FIRST_BUILD_NOTE } from './toolchain.mjs';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe('cacheDir', () => {
  it('is under Library/Caches on macOS, keyed by the React Native version', () => {
    assert.equal(
      cacheDir('0.88.0', { env: {}, platform: 'darwin', home: '/Users/me' }),
      '/Users/me/Library/Caches/ng-native/desktop/rn-0.88.0',
    );
  });

  it('follows XDG_CACHE_HOME elsewhere, and falls back to ~/.cache', () => {
    assert.equal(
      cacheDir('0.88.0', { env: { XDG_CACHE_HOME: '/xdg' }, platform: 'linux', home: '/home/me' }),
      '/xdg/ng-native/desktop/rn-0.88.0',
    );
    assert.equal(
      cacheDir('0.88.0', { env: {}, platform: 'linux', home: '/home/me' }),
      '/home/me/.cache/ng-native/desktop/rn-0.88.0',
    );
  });

  it('takes NGN_DESKTOP_CACHE over the default', () => {
    assert.equal(
      cacheDir('0.88.0', {
        env: { NGN_DESKTOP_CACHE: '/ci/cache' },
        platform: 'darwin',
        home: '/Users/me',
      }),
      '/ci/cache/rn-0.88.0',
    );
  });

  it('agrees with the build scripts', () => {
    const script = path.join(packageDir, 'native', 'scripts', 'cache-dir.sh');
    for (const env of [{}, { NGN_DESKTOP_CACHE: '/ci/cache' }]) {
      const fromScript = execFileSync(script, ['0.88.0'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: '/Users/me', ...env },
      }).trim();
      assert.equal(fromScript, cacheDir('0.88.0', { env, home: '/Users/me' }));
    }
  });
});

describe('parseCommand', () => {
  it('reads run with its bundle and options', () => {
    assert.deepEqual(parseCommand(['run', 'dist/main.hbc']), {
      command: 'run',
      bundle: 'dist/main.hbc',
      module: 'main',
      port: 8081,
      universal: false,
    });
    assert.deepEqual(
      parseCommand([
        'run',
        'http://localhost:8081/index.bundle',
        '--module',
        'other',
        '--universal',
      ]),
      {
        command: 'run',
        bundle: 'http://localhost:8081/index.bundle',
        module: 'other',
        port: 8081,
        universal: true,
      },
    );
  });

  it('prints help with no command', () => {
    assert.deepEqual(parseCommand([]), { command: 'help' });
    assert.deepEqual(parseCommand(['--help']), { command: 'help' });
  });

  it('reads run with no bundle, which loads from the dev server, and its port', () => {
    assert.deepEqual(parseCommand(['run', '--port', '8082']), {
      command: 'run',
      bundle: undefined,
      module: 'main',
      port: 8082,
      universal: false,
    });
  });

  it('refuses an unknown command, a run with two bundles and a port that is not one', () => {
    assert.throws(() => parseCommand(['bundle']), UsageError);
    assert.throws(() => parseCommand(['run', 'a.js', 'b.js']), UsageError);
    assert.throws(() => parseCommand(['run', '--port', 'eighty']), /--port takes a port number/);
    assert.throws(() => parseCommand(['run', '--port', '70000']), UsageError);
  });
});

/** What the toolchain check (toolchain.mjs) asks, answered by a Mac that has every tool. */
const TOOLCHAIN: Record<string, string> = {
  'xcode-select --print-path': '/Applications/Xcode.app/Contents/Developer\n',
  'xcrun swiftc --version': 'Apple Swift version 6.2 (swiftlang-6.2.0.19.9 clang-1700.3.19.1)\n',
  'cmake --version': 'cmake version 3.31.6\n',
  'ninja --version': '1.12.1\n',
};

/** A system that records what run() asks of it. */
function fakeSystem(overrides: Partial<typeof system> = {}) {
  const calls: { command: string; args: string[]; env?: Record<string, string> }[] = [];
  const written: Record<string, string> = {};
  const warnings: string[] = [];
  const sys: typeof system = {
    platform: 'darwin',
    cwd: () => '/apps/demo',
    resolveReactNative: () => '/apps/demo/node_modules/react-native',
    resolvePackage: () => null,
    env: {},
    readFile: () => '',
    expo: () => ({ status: 0 }),
    sha256: () => '',
    rename: () => {},
    exists: () => false,
    remove: () => {},
    copy: () => {},
    links: () => ({
      os: 'macos',
      libraries: [],
      appModules: [],
      hostLibraries: [],
      withoutDesktop: [],
      problems: [],
    }),
    writeFile: (file, text) => void (written[file] = text),
    warn: (line) => void warnings.push(line),
    host(command, args) {
      return Promise.resolve(this.run(command, args).status);
    },
    run(command, args, options) {
      const probe = TOOLCHAIN[[command, ...args].join(' ')];
      if (probe !== undefined) return { status: 0, stdout: probe };
      calls.push({ command, args, ...(options?.env && { env: options.env }) });
      return command.endsWith('build.sh')
        ? {
            status: 0,
            stdout: 'configure noise\n/cache/rn-0.88.0/host/appkit-arm64-RelWithDebInfo\n',
          }
        : { status: 0, stdout: '' };
    },
    expoConfig: () => ({
      name: 'Demo',
      slug: 'demo',
      platforms: ['ios', 'android', 'macos'],
      experiments: { outOfTreePlatforms: true },
      ios: { bundleIdentifier: 'com.example.demo' },
    }),
    ...overrides,
  };
  return { sys, calls, written, warnings };
}

describe('run', () => {
  it('builds against the app’s react-native without the core tests, then opens the bundle in the host it built', async () => {
    const { sys, calls } = fakeSystem();
    const status = await run({ bundle: 'dist/main.hbc', module: 'main', universal: true }, sys);
    assert.equal(status, 0);
    assert.deepEqual(calls, [
      {
        command: path.join(packageDir, 'native', 'scripts', 'build.sh'),
        // The published package has no core test sources (published-files.test.ts).
        args: ['/apps/demo/node_modules/react-native', '--universal', '--no-tests'],
        env: { NGN_DESKTOP_LINK: '/apps/demo/.expo/ng-native-desktop/link.json' },
      },
      {
        command: '/cache/rn-0.88.0/host/appkit-arm64-RelWithDebInfo/appkit/ngn-macos',
        args: [
          '/apps/demo/dist/main.hbc',
          '--module',
          'main',
          '--title',
          'Demo',
          '--app-id',
          'com.example.demo',
        ],
      },
    ]);
  });

  it('runs on the prebuilt debug host for its React Native version, compiling nothing', async () => {
    const sha = 'c'.repeat(64);
    const manifest = JSON.stringify({
      version: 1,
      hosts: [
        {
          reactNative: '0.88.0',
          url: 'https://e.com/r.tar.gz',
          sha256: 'f'.repeat(64),
          libraries: {},
        },
        {
          reactNative: '0.88.0',
          flavour: 'debug',
          url: 'https://e.com/h.tar.gz',
          sha256: sha,
          libraries: {},
        },
      ],
    });
    const cache = { NGN_DESKTOP_CACHE: '/cache' };
    const host = '/cache/rn-0.88.0/prebuilt/cccccccccccccccc/appkit/ngn-macos';
    const files: Record<string, string> = {
      [path.join(packageDir, 'prebuilt.json')]: manifest,
      '/apps/demo/node_modules/react-native/package.json': '{"version":"0.88.0"}',
    };
    const prebuilt = fakeSystem({
      env: cache,
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === host,
    });
    await run({ bundle: 'dist/main.hbc', module: 'main', universal: false }, prebuilt.sys);
    assert.deepEqual(
      prebuilt.calls.map((call) => call.command),
      [host],
    );

    // A host library nested under a dependency, another version than the prebuilt's, builds too.
    const nested = '/apps/demo/node_modules/kit/node_modules/react-native-svg';
    const mismatched = fakeSystem({
      env: cache,
      readFile: (file) =>
        file === path.join(packageDir, 'prebuilt.json')
          ? JSON.stringify({
              version: 1,
              hosts: [
                {
                  reactNative: '0.88.0',
                  flavour: 'debug',
                  url: 'https://e.com/h.tar.gz',
                  sha256: sha,
                  libraries: { 'react-native-svg': '15.16.0' },
                },
              ],
            })
          : file === `${nested}/package.json`
            ? '{"version":"15.0.0"}'
            : (files[file] ?? ''),
      exists: (file) => file === host,
      links: () => ({
        os: 'macos' as const,
        libraries: [],
        appModules: [],
        hostLibraries: [{ name: 'react-native-svg', dir: nested }],
        withoutDesktop: [],
        problems: [],
      }),
    });
    await run({ bundle: 'dist/main.hbc', module: 'main', universal: false }, mismatched.sys);
    assert.ok(mismatched.calls[0]!.command.endsWith('build.sh'), 'built from source');

    // With native code of its own linked, the app builds its host.
    const linked = fakeSystem({
      env: cache,
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === host,
      links: () => ({
        os: 'macos' as const,
        libraries: [],
        appModules: [{ name: 'Mine', dir: '/apps/demo/desktop' }] as never,
        hostLibraries: [],
        withoutDesktop: [],
        problems: [],
      }),
    });
    await run({ bundle: 'dist/main.hbc', module: 'main', universal: false }, linked.sys);
    assert.ok(linked.calls[0]!.command.endsWith('build.sh'));
  });

  it('takes the debug prebuilt host for a run and the release one for a package', () => {
    const entry = (flavour: string | undefined, hash: string) => ({
      reactNative: '0.88.0',
      ...(flavour && { flavour }),
      url: `https://e.com/${hash}.tar.gz`,
      sha256: hash.repeat(64),
      libraries: {},
    });
    const hostOf = (hash: string) => `/cache/rn-0.88.0/prebuilt/${hash.repeat(16)}`;
    const prepare = (hosts: object[], release: boolean, env: Record<string, string> = {}) => {
      const { sys, calls } = fakeSystem({
        env: { NGN_DESKTOP_CACHE: '/cache', ...env },
        readFile: (file) =>
          file === path.join(packageDir, 'prebuilt.json')
            ? JSON.stringify({ version: 1, hosts })
            : file === '/apps/demo/node_modules/react-native/package.json'
              ? '{"version":"0.88.0"}'
              : '',
        // Both hosts are already in the cache.
        exists: (file) => ['d', 'e'].some((hash) => file === `${hostOf(hash)}/appkit/ngn-macos`),
      });
      const { buildDir } = prepareHost(sys, { universal: release, release });
      return { buildDir, calls };
    };
    const both = [entry('release', 'e'), entry('debug', 'd')];
    assert.equal(prepare(both, false).buildDir, hostOf('d'));
    assert.equal(prepare(both, true).buildDir, hostOf('e'));
    // An entry with no flavour, as an older manifest has, is the release host.
    const older = [entry(undefined, 'e')];
    assert.equal(prepare(older, true).buildDir, hostOf('e'));

    // No host of the flavour asked for: built from source, as a run and a package build it.
    const build = path.join(packageDir, 'native', 'scripts', 'build.sh');
    for (const [hosts, release, flag] of [
      [older, false, '--no-tests'],
      [[entry('debug', 'd')], true, '--release'],
    ] as const) {
      const { buildDir, calls } = prepare([...hosts], release);
      assert.equal(buildDir, '/cache/rn-0.88.0/host/appkit-arm64-RelWithDebInfo');
      assert.equal(calls[0]!.command, build);
      assert.equal(calls[0]!.args.at(-1), flag);
    }
    // NGN_DESKTOP_FROM_SOURCE=1 builds from source for both, with both hosts there.
    for (const release of [false, true]) {
      const { calls } = prepare(both, release, { NGN_DESKTOP_FROM_SOURCE: '1' });
      assert.equal(calls[0]!.command, build);
    }
  });

  it('compiles in the host libraries the app has installed, and only those', async () => {
    const asked: string[] = [];
    const { sys, calls } = fakeSystem({
      resolvePackage: (from, name) => {
        assert.equal(from, '/apps/demo');
        asked.push(name);
        return name === 'react-native-screens' ||
          name === 'react-native-svg' ||
          name === 'react-native-webview'
          ? `/apps/demo/node_modules/${name}`
          : null;
      },
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(asked, HOST_LIBRARIES);
    // react-native-svg's views, which `@ng-native/icons` commits, are drawn by the host.
    assert.deepEqual(calls[0].args, [
      '/apps/demo/node_modules/react-native',
      '--library',
      '/apps/demo/node_modules/react-native-screens',
      '--library',
      '/apps/demo/node_modules/react-native-svg',
      '--library',
      '/apps/demo/node_modules/react-native-webview',
      '--no-tests',
    ]);
  });

  it('compiles in a host library autolinking found under a dependency, which the app root misses', async () => {
    const nested = '/apps/demo/node_modules/kit/node_modules/react-native-svg';
    const { sys, calls } = fakeSystem({
      resolvePackage: (_, name) =>
        name === 'react-native-screens' ? `/apps/demo/node_modules/${name}` : null,
      links: () => ({
        os: 'macos' as const,
        libraries: [],
        appModules: [],
        hostLibraries: [{ name: 'react-native-svg', dir: nested }],
        withoutDesktop: [],
        problems: [],
      }),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(calls[0]!.args, [
      '/apps/demo/node_modules/react-native',
      '--library',
      '/apps/demo/node_modules/react-native-screens',
      '--library',
      nested,
      '--no-tests',
    ]);
  });

  it('writes the native code autolinking found for the build, and names the file to it', async () => {
    const library = {
      name: 'rn-haptics',
      dir: '/apps/demo/node_modules/rn-haptics',
      cmakeTarget: 'haptics_desktop',
      cmakeDir: '/apps/demo/node_modules/rn-haptics/desktop',
    };
    const appModule = { name: 'clock', dir: '/apps/demo/modules/clock/macos', cmakeTarget: null };
    const asked: unknown[] = [];
    const { sys, calls, written } = fakeSystem({
      links: (appDir, options) => (
        asked.push({ appDir, options }),
        {
          os: 'macos' as const,
          libraries: [library],
          appModules: [appModule],
          hostLibraries: [],
          withoutDesktop: [],
          problems: [],
        }
      ),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(asked, [
      { appDir: '/apps/demo', options: { os: 'macos', deny: [], builtIn: HOST_LIBRARIES } },
    ]);
    assert.equal(linkFile('/apps/demo'), '/apps/demo/.expo/ng-native-desktop/link.json');
    assert.deepEqual(JSON.parse(written[linkFile('/apps/demo')]!), {
      version: 1,
      os: 'macos',
      libraries: [library],
      appModules: [appModule],
    });
    assert.equal(calls[0]!.env!['NGN_DESKTOP_LINK'], linkFile('/apps/demo'));
  });

  it('writes the file with nothing in it when nothing links, so a removed library is gone', async () => {
    const { sys, written } = fakeSystem();
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(JSON.parse(written[linkFile('/apps/demo')]!), {
      version: 1,
      os: 'macos',
      libraries: [],
      appModules: [],
    });
  });

  it('autolinks for the OS it is asked to build for, and names it in the file', () => {
    const asked: unknown[] = [];
    const { sys, written } = fakeSystem({
      platform: 'linux',
      expoConfig: () => ({
        name: 'Demo',
        slug: 'demo',
        platforms: ['ios', 'android', 'linux'],
        experiments: { outOfTreePlatforms: true },
      }),
      links: (appDir, options) => (
        asked.push({ appDir, options }),
        {
          os: 'linux' as const,
          libraries: [],
          appModules: [{ name: 'clock', dir: '/apps/demo/modules/clock/linux', cmakeTarget: null }],
          hostLibraries: [],
          withoutDesktop: [],
          problems: [],
        }
      ),
    });
    prepareHost(sys, { universal: false, os: 'linux' });
    assert.deepEqual(asked, [
      { appDir: '/apps/demo', options: { os: 'linux', deny: [], builtIn: HOST_LIBRARIES } },
    ]);
    assert.equal(JSON.parse(written[linkFile('/apps/demo')]!).os, 'linux');
  });

  it('builds a Linux host from source, never taking a prebuilt one, which is a macOS host', () => {
    const host = '/cache/rn-0.88.0/prebuilt/cccccccccccccccc/appkit/ngn-macos';
    const files: Record<string, string> = {
      [path.join(packageDir, 'prebuilt.json')]: JSON.stringify({
        version: 1,
        hosts: [
          {
            reactNative: '0.88.0',
            flavour: 'debug',
            url: 'https://e.com/h.tar.gz',
            sha256: 'c'.repeat(64),
            libraries: {},
          },
        ],
      }),
      '/apps/demo/node_modules/react-native/package.json': '{"version":"0.88.0"}',
    };
    const linux = fakeSystem({
      platform: 'linux',
      env: { NGN_DESKTOP_CACHE: '/cache' },
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === host,
      expoConfig: () => ({
        name: 'Demo',
        slug: 'demo',
        platforms: ['ios', 'android', 'linux'],
        experiments: { outOfTreePlatforms: true },
      }),
    });
    const prebuiltDir = '/cache/rn-0.88.0/prebuilt/cccccccccccccccc';
    assert.notEqual(
      prepareHost(linux.sys, { universal: false, os: 'linux' }).buildDir,
      prebuiltDir,
    );
    // The same app on a Mac takes it.
    const mac = fakeSystem({
      env: { NGN_DESKTOP_CACHE: '/cache' },
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === host,
    });
    assert.equal(prepareHost(mac.sys, { universal: false }).buildDir, prebuiltDir);
  });

  it('checks the Expo config for the OS being built, and the machine it builds on', () => {
    // A Mac config that does not list linux.
    assert.throws(
      () => prepareHost(fakeSystem({ platform: 'linux' }).sys, { universal: false, os: 'linux' }),
      /does not list linux/,
    );
    assert.throws(
      () => prepareHost(fakeSystem().sys, { universal: false, os: 'linux' }),
      /The Linux desktop host builds on Linux only for now/,
    );
  });

  it('warns about dependencies whose native code the build leaves out', async () => {
    const { sys, warnings } = fakeSystem({
      links: () => ({
        os: 'macos' as const,
        libraries: [],
        appModules: [],
        hostLibraries: [],
        withoutDesktop: ['react-native-mmkv'],
        problems: [],
      }),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.match(warnings.join('\n'), /No desktop code in react-native-mmkv/);
  });

  it('keeps a denied host library out of the build, and passes the deny-list to autolinking', async () => {
    let deny: readonly string[] | undefined;
    const { sys, calls } = fakeSystem({
      resolvePackage: (_, name) => `/apps/demo/node_modules/${name}`,
      links: (_, options) => (
        (deny = options?.deny),
        {
          os: 'macos' as const,
          libraries: [],
          appModules: [],
          hostLibraries: [],
          withoutDesktop: [],
          problems: [],
        }
      ),
      expoConfig: () => ({
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        plugins: [['@ng-native/desktop', { deny: ['react-native-screens', 'rn-other'] }]],
      }),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(deny, ['react-native-screens', 'rn-other']);
    assert.deepEqual(calls[0]!.args, [
      '/apps/demo/node_modules/react-native',
      '--library',
      '/apps/demo/node_modules/react-native-safe-area-context',
      '--library',
      '/apps/demo/node_modules/react-native-svg',
      '--library',
      '/apps/demo/node_modules/react-native-webview',
      '--library',
      '/apps/demo/node_modules/react-native-worklets',
      '--library',
      '/apps/demo/node_modules/react-native-reanimated',
      '--no-tests',
    ]);
  });

  it('loads from the dev server by URL when no bundle is given', async () => {
    const { sys, calls } = fakeSystem();
    await run({ module: 'main', port: 8082, universal: false }, sys);
    assert.equal(
      calls[1].args[0],
      'http://localhost:8082/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true',
    );
    assert.equal(devServerBundleUrl(8081), calls[1].args[0].replace('8082', '8081'));
  });

  it('opens the app on a link given with --url, as its initial URL', async () => {
    assert.deepEqual(parseCommand(['run', '--url', 'demo://settings']), {
      command: 'run',
      bundle: undefined,
      module: 'main',
      port: 8081,
      universal: false,
      url: 'demo://settings',
    });
    assert.equal('url' in parseCommand(['run']), false);
    const { sys, calls } = fakeSystem();
    await run({ module: 'main', universal: false, url: 'demo://settings' }, sys);
    assert.deepEqual(calls[1].args.slice(-2), ['--url', 'demo://settings']);
  });

  it('passes a bundle URL to the host as it is, so it stays connected to the dev server', async () => {
    const { sys, calls } = fakeSystem();
    const url = 'http://localhost:8081/index.bundle?platform=macos&dev=true';
    await run({ bundle: url, module: 'main', universal: false }, sys);
    assert.equal(calls[1].args[0], url);
  });

  it('names the app from its slug when it has no bundle identifier', async () => {
    const { sys, calls } = fakeSystem({
      expoConfig: () => ({
        slug: 'demo',
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
      }),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(calls[1].args.slice(3), ['--title', 'demo', '--app-id', 'demo']);
  });

  it('passes the capabilities in the plugin options to the host, as the packaged Info.plist has them', async () => {
    const { sys, calls } = fakeSystem({
      expoConfig: () => ({
        slug: 'demo',
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        plugins: [
          [
            '@ng-native/desktop',
            {
              capabilities: {
                spawn: [{ program: 'git', args: ['status'] }],
                env: ['HOME'],
                paths: [{ path: '~/Notes' }],
              },
            },
          ],
        ],
      }),
    });
    await run({ module: 'main', universal: false }, sys);
    const args = calls[1]!.args;
    const at = args.indexOf('--capabilities');
    assert.notEqual(at, -1);
    assert.deepEqual(JSON.parse(args[at + 1]!), {
      spawn: [{ program: 'git', args: ['status'] }],
      env: ['HOME'],
      paths: [{ path: '~/Notes', access: 'read' }],
    });
  });

  it('passes no capabilities where the plugin options give none', async () => {
    const { sys, calls } = fakeSystem();
    await run({ module: 'main', universal: false }, sys);
    assert.equal(calls[1]!.args.includes('--capabilities'), false);
  });

  it('stops with a fix-it line, before building, when the Expo config does not list macos', async () => {
    const { sys, calls } = fakeSystem({
      expoConfig: () => ({ platforms: ['ios', 'android'] }),
    });
    await assert.rejects(
      run({ module: 'main', universal: false }, sys),
      (error: Error) =>
        error instanceof UsageError &&
        /Add "macos" to expo.platforms in app.json and set expo.experiments.outOfTreePlatforms to true/.test(
          error.message,
        ),
    );
    assert.equal(calls.length, 0);
  });

  it('stops before building when the desktop plugin options are not valid', async () => {
    const { sys, calls } = fakeSystem({
      expoConfig: () => ({
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        plugins: [['@ng-native/desktop', { capabilities: { env: ['NOT-A-NAME'] } }]],
      }),
    });
    await assert.rejects(
      run({ module: 'main', universal: false }, sys),
      /capabilities\.env\[0\]: "NOT-A-NAME" is not an environment variable name/,
    );
    assert.equal(calls.length, 0);
  });

  it('checks the toolchain before it builds, and stops on a missing tool without building', async () => {
    const asked: string[] = [];
    const { sys, calls } = fakeSystem({
      run(command, args) {
        const line = [command, ...args].join(' ');
        asked.push(line);
        if (line === 'ninja --version') {
          throw Object.assign(new Error('spawnSync ninja ENOENT'), { code: 'ENOENT' });
        }
        const probe = TOOLCHAIN[line];
        if (probe !== undefined) return { status: 0, stdout: probe };
        calls.push({ command, args });
        return { status: 0, stdout: '/b\n' };
      },
    });
    await assert.rejects(
      run({ bundle: 'a.js', module: 'main', universal: false }, sys),
      (error: unknown) =>
        error instanceof UsageError &&
        /Ninja is not installed\. Install it: brew install ninja/.test(error.message),
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(asked, [
      'xcode-select --print-path',
      'xcrun swiftc --version',
      'cmake --version',
      'ninja --version',
    ]);
  });

  it('says how long the first build takes, once, before building for a React Native version the cache lacks', async () => {
    const files: Record<string, string> = {
      '/apps/demo/node_modules/react-native/package.json': '{"version":"0.88.0"}',
    };
    const first = fakeSystem({
      env: { NGN_DESKTOP_CACHE: '/cache' },
      readFile: (file) => files[file] ?? '',
    });
    await run({ bundle: 'a.js', module: 'main', universal: false }, first.sys);
    assert.deepEqual(first.warnings, [FIRST_BUILD_NOTE]);
    assert.match(FIRST_BUILD_NOTE, /about 4 minutes/);

    const later = fakeSystem({
      env: { NGN_DESKTOP_CACHE: '/cache' },
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === '/cache/rn-0.88.0/host',
    });
    await run({ bundle: 'a.js', module: 'main', universal: false }, later.sys);
    assert.deepEqual(later.warnings, []);
  });

  it('stops when the build fails, without launching', async () => {
    const { sys, calls } = fakeSystem({
      run: (command, args) =>
        TOOLCHAIN[[command, ...args].join(' ')] !== undefined
          ? { status: 0, stdout: TOOLCHAIN[[command, ...args].join(' ')]! }
          : (calls.push({ command, args }), { status: 1, stdout: '' }),
    });
    await assert.rejects(
      run({ bundle: 'a.js', module: 'main', universal: false }, sys),
      /did not build/,
    );
    assert.equal(calls.length, 1);
  });

  it('refuses to run off macOS, and outside an app with react-native', async () => {
    await assert.rejects(
      run(
        { bundle: 'a.js', module: 'main', universal: false },
        fakeSystem({ platform: 'linux' }).sys,
      ),
      /macOS only/,
    );
    const noReactNative = fakeSystem({
      resolveReactNative: () => {
        throw new Error('not found');
      },
    }).sys;
    await assert.rejects(
      run({ bundle: 'a.js', module: 'main', universal: false }, noReactNative),
      /react-native is not installed/,
    );
  });
});

describe('checkExpoConfig', () => {
  it('asks for the OS it is checking, linux included', () => {
    const config = { platforms: ['macos'], experiments: { outOfTreePlatforms: true } };
    assert.throws(() => checkExpoConfig(config, 'linux'), /does not list linux/);
    assert.doesNotThrow(() =>
      checkExpoConfig({ ...config, platforms: ['macos', 'linux'] }, 'linux'),
    );
    assert.throws(
      () => checkExpoConfig({ platforms: ['linux'] }, 'linux'),
      /lists linux without expo.experiments.outOfTreePlatforms/,
    );
  });

  it('needs macos listed and the out-of-tree platforms experiment on', () => {
    assert.doesNotThrow(() =>
      checkExpoConfig({ platforms: ['macos'], experiments: { outOfTreePlatforms: true } }),
    );
    assert.throws(() => checkExpoConfig({}), /does not list macos/);
    assert.throws(
      () => checkExpoConfig({ platforms: ['macos'] }),
      /without expo.experiments.outOfTreePlatforms/,
    );
  });
});

describe('main', () => {
  it('exits 2 with the usage on a usage error and passes the host’s status through', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      assert.equal(await main(['frobnicate'], fakeSystem().sys), 2);
      assert.match(errors[0], /Unknown command "frobnicate"[\s\S]*Usage: ng-native-desktop run/);
      assert.equal(await main(['run', 'a.js', '--bogus'], fakeSystem().sys), 2);
    } finally {
      console.error = original;
    }
    const exiting = fakeSystem({
      run: (command, args) => ({
        status: command.endsWith('ngn-macos') ? 3 : 0,
        stdout: TOOLCHAIN[[command, ...args].join(' ')] ?? '/b\n',
      }),
    });
    assert.equal(await main(['run', 'a.js'], exiting.sys), 3);
  });
});

describe('system.host', () => {
  it('passes the environment on, and a SIGTERM to the host, and exits with the host’s status', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-host-signal-'));
    try {
      const log = path.join(dir, 'log');
      const host = path.join(dir, 'host.cjs');
      writeFileSync(
        host,
        `const fs = require('node:fs');
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, 'TERM\\n'); process.exit(7); });
fs.writeFileSync(${JSON.stringify(log)}, 'env ' + process.env.NGN_RUN_ID + '\\n');
setInterval(() => {}, 1000);`,
      );
      const cli = path.join(dir, 'cli.mjs');
      writeFileSync(
        cli,
        `import { system } from ${JSON.stringify(path.join(packageDir, 'bin', 'host.mjs'))};
process.exitCode = await system.host(process.execPath, [${JSON.stringify(host)}]);`,
      );
      const child = spawn(process.execPath, [cli], {
        env: { ...process.env, NGN_RUN_ID: 'run-1' },
        stdio: 'ignore',
      });
      const exited = new Promise<number | null>((resolve) =>
        child.once('exit', (code) => resolve(code)),
      );
      for (let i = 0; i < 100 && !existsSync(log); i++) await new Promise((r) => setTimeout(r, 50));
      const sent = Date.now();
      child.kill('SIGTERM');
      assert.equal(await exited, 7);
      assert.ok(Date.now() - sent < 3000);
      assert.equal(readFileSync(log, 'utf8'), 'env run-1\nTERM\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
