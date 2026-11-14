import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cacheDir, main, parseCommand, run, system, UsageError } from './cli.mjs';

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
        universal: true,
      },
    );
  });

  it('prints help with no command', () => {
    assert.deepEqual(parseCommand([]), { command: 'help' });
    assert.deepEqual(parseCommand(['--help']), { command: 'help' });
  });

  it('refuses an unknown command and a run without exactly one bundle', () => {
    assert.throws(() => parseCommand(['package']), UsageError);
    assert.throws(() => parseCommand(['run']), UsageError);
    assert.throws(() => parseCommand(['run', 'a.js', 'b.js']), UsageError);
  });
});

/** A system that records what run() asks of it. */
function fakeSystem(overrides: Partial<typeof system> = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const sys: typeof system = {
    platform: 'darwin',
    cwd: () => '/apps/demo',
    resolveReactNative: () => '/apps/demo/node_modules/react-native',
    run(command, args) {
      calls.push({ command, args });
      return command.endsWith('build.sh')
        ? {
            status: 0,
            stdout: 'configure noise\n/cache/rn-0.88.0/host/appkit-arm64-RelWithDebInfo\n',
          }
        : { status: 0, stdout: '' };
    },
    download: async () => '/tmp/downloaded/bundle.js',
    ...overrides,
  };
  return { sys, calls };
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
      },
      {
        command: '/cache/rn-0.88.0/host/appkit-arm64-RelWithDebInfo/appkit/ngn-macos',
        args: ['/apps/demo/dist/main.hbc', '--module', 'main'],
      },
    ]);
  });

  it('downloads a bundle URL before launching', async () => {
    const { sys, calls } = fakeSystem();
    await run(
      {
        bundle: 'http://localhost:8081/index.bundle?platform=macos',
        module: 'main',
        universal: false,
      },
      sys,
    );
    assert.deepEqual(calls[1].args, ['/tmp/downloaded/bundle.js', '--module', 'main']);
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
