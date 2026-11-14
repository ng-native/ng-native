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
    links: () => ({ libraries: [], appModules: [], withoutDesktop: [], problems: [] }),
    writeFile: (file, text) => void (written[file] = text),
    warn: (line) => void warnings.push(line),
    host(command, args) {
      return Promise.resolve(this.run(command, args).status);
    },
    run(command, args, options) {
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
  it('builds against the app’s react-native, then opens the bundle in the host it built', async () => {
    const { sys, calls } = fakeSystem();
    const status = await run({ bundle: 'dist/main.hbc', module: 'main', universal: true }, sys);
    assert.equal(status, 0);
    assert.deepEqual(calls, [
      {
        command: path.join(packageDir, 'native', 'scripts', 'build.sh'),
        args: ['/apps/demo/node_modules/react-native', '--universal'],
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

  it('runs on the prebuilt host for its React Native version, compiling nothing', async () => {
    const sha = 'c'.repeat(64);
    const manifest = JSON.stringify({
      version: 1,
      hosts: [{ reactNative: '0.88.0', url: 'https://e.com/h.tar.gz', sha256: sha, libraries: {} }],
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

    // With native code of its own linked, the app builds its host.
    const linked = fakeSystem({
      env: cache,
      readFile: (file) => files[file] ?? '',
      exists: (file) => file === host,
      links: () => ({
        libraries: [],
        appModules: [{ name: 'Mine', dir: '/apps/demo/desktop' }] as never,
        withoutDesktop: [],
        problems: [],
      }),
    });
    await run({ bundle: 'dist/main.hbc', module: 'main', universal: false }, linked.sys);
    assert.ok(linked.calls[0]!.command.endsWith('build.sh'));
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
        { libraries: [library], appModules: [appModule], withoutDesktop: [], problems: [] }
      ),
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(asked, [
      { appDir: '/apps/demo', options: { deny: [], builtIn: HOST_LIBRARIES } },
    ]);
    assert.equal(linkFile('/apps/demo'), '/apps/demo/.expo/ng-native-desktop/link.json');
    assert.deepEqual(JSON.parse(written[linkFile('/apps/demo')]!), {
      version: 1,
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
      libraries: [],
      appModules: [],
    });
  });

  it('warns about dependencies whose native code the build leaves out', async () => {
    const { sys, warnings } = fakeSystem({
      links: () => ({
        libraries: [],
        appModules: [],
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
        { libraries: [], appModules: [], withoutDesktop: [], problems: [] }
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

  it('stops when the build fails, without launching', async () => {
    const { sys, calls } = fakeSystem({
      run: (command, args) => (calls.push({ command, args }), { status: 1, stdout: '' }),
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
      run: (command) => ({ status: command.endsWith('ngn-macos') ? 3 : 0, stdout: '/b\n' }),
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
fs.writeFileSync(${JSON.stringify(log)}, 'env ' + process.env.NGN_RUN_ID + '\\n');
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, 'TERM\\n'); process.exit(7); });
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
