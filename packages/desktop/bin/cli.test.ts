import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    exists: () => false,
    remove: () => {},
    copy: () => {},
    links: () => ({ libraries: [], appModules: [], withoutDesktop: [], problems: [] }),
    writeFile: (file, text) => void (written[file] = text),
    warn: (line) => void warnings.push(line),
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

  it('compiles in the host libraries the app has installed, and only those', async () => {
    const asked: string[] = [];
    const { sys, calls } = fakeSystem({
      resolvePackage: (from, name) => {
        assert.equal(from, '/apps/demo');
        asked.push(name);
        return name === 'react-native-screens' ? `/apps/demo/node_modules/${name}` : null;
      },
    });
    await run({ module: 'main', universal: false }, sys);
    assert.deepEqual(asked, HOST_LIBRARIES);
    assert.deepEqual(calls[0].args, [
      '/apps/demo/node_modules/react-native',
      '--library',
      '/apps/demo/node_modules/react-native-screens',
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
