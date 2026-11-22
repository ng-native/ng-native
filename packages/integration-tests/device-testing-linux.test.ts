/**
 * The Node half of in-app tests on Linux: `vitest --project linux` runs a project whose pool starts
 * the GTK host itself (`linuxLauncher()`) and treats it as one more session platform, as
 * `vitest --project macos` does on a Mac (device-testing-macos.test.ts holds the shared contract).
 * Here the host is a stand-in script, run directly through the launcher's session script, so these
 * tests hold the pool, the launcher and the Vitest plugin to the Linux half of the contract:
 *
 * 1. Launch. The host is run as `ngn-linux <bundle> --app-id <id>`, the bundle the dev server's
 *    Linux one and the id unique to the launch, so single-instance activation never joins another
 *    run. Its environment has the test variables of every desktop host, and the XDG folders and
 *    `TMPDIR` under `NGN_STATE_DIR`.
 * 2. Exit. SIGTERM reaches the host through the session script, and a host ended by a signal is
 *    reported by that signal's name. Linux has no crash report folder, so the failure of a file a
 *    lost host was running quotes the end of the host's output.
 * 3. Off Linux, the host runs in the AlmaLinux 9 image, which reaches the pool and Metro through
 *    ports it forwards to the machine running Vitest.
 */
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  desktopCliHost,
  FAKE_PORTALS,
  imageNamed,
  linuxBundleUrl,
  linuxLaunchCommand,
  linuxLauncher,
  ROOT_PRELUDE,
  sessionScript,
  testApplicationId,
} from '@ng-native/testing/device/linux-launcher';
import { devicePool } from '@ng-native/testing/device/pool';
import { deviceTests } from '@ng-native/testing/device/vitest';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A stand-in host: records its launch, polls the pool as a Linux app, and ends on SIGTERM, or kills
 * itself on the first request when asked to crash, after a line on stderr.
 */
const HOST = `
const fs = require('node:fs');
const env = process.env;
const pick = (names) => Object.fromEntries(names.map((name) => [name, env[name]]));
fs.appendFileSync(env.LOG, JSON.stringify({
  argv: process.argv.slice(2),
  ...pick(['NGN_TESTS', 'NGN_STATE_DIR', 'NGN_RUN_ID', 'NGN_TESTS_FAKE_SYSTEM_UI', 'XDG_DATA_HOME',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR']),
  made: ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR'].every((name) => fs.existsSync(env[name])),
}) + '\\n');
process.on('SIGTERM', () => {
  fs.appendFileSync(env.LOG, JSON.stringify({ terminated: env.NGN_RUN_ID }) + '\\n');
  process.exit(0);
});
const session = 'linux-' + env.NGN_RUN_ID;
let reply = null;
(async () => {
  for (;;) {
    const response = await fetch('http://127.0.0.1:' + env.POOL_PORT + '/poll', {
      method: 'POST',
      body: JSON.stringify({ session, platform: 'linux', script: 'http://127.0.0.1:1/i.bundle?platform=linux', defined: [], hashes: {}, reply }),
    });
    const request = await response.json();
    reply = null;
    if (!request) continue;
    fs.appendFileSync(env.LOG, JSON.stringify({ got: request.type, session }) + '\\n');
    if (request.type === 'cancel' && env.CRASH_FIRST && !fs.existsSync(env.CRASH_FIRST)) {
      fs.writeFileSync(env.CRASH_FIRST, '1');
      fs.writeFileSync(env.NGN_STATE_DIR + '/crash.txt', 'ngn-linux crashed: SIGSEGV (signal 11)\\nNative stack:\\n#0 stand-in\\n');
      process.stderr.write('Gdk-ERROR: stand-in for the host aborting\\n');
      process.kill(process.pid, 'SIGKILL');
    }
    reply = { __vitest_worker_response__: true, type: 'testfileFinished', deviceRequest: request.deviceRequest };
  }
})();
`;

async function setup(options: { crash?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'linux-pool-'));
  const log = join(dir, 'launches.log');
  writeFileSync(log, '');
  const script = join(dir, 'host.cjs');
  writeFileSync(script, HOST);
  const port = await freePort();
  const launch = linuxLauncher({
    host: process.execPath,
    args: [script],
    metroPort: 8099,
    display: 'inherit',
    container: false,
    fakeSystemUi: false,
    env: {
      LOG: log,
      POOL_PORT: String(port),
      ...(options.crash ? { CRASH_FIRST: join(dir, 'crashed') } : {}),
    },
  });
  const pool = devicePool({
    port,
    platform: 'linux',
    metroPort: 8099,
    launch,
    connectTimeout: 10_000,
    appTimeout: 5000,
  });
  const workers: ReturnType<typeof pool.createPoolWorker>[] = [];
  const worker = () => {
    const made = pool.createPoolWorker({ project: { config: { root: dir } } } as never);
    const messages: { error?: Error; type?: string }[] = [];
    made.on('message', (message) => void messages.push(message as never));
    workers.push(made);
    return { worker: made, messages };
  };
  const launches = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const done = async () => {
    for (const made of workers) await made.stop();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, worker, launches, done };
}

const request = (type: string) => ({ __vitest_worker_request__: true, type, context: {} });

describe('the Linux launcher', () => {
  it('starts the host on the Linux bundle with its own app id, state and XDG folders, and removes them', async () => {
    const run = await setup();
    try {
      const { worker, messages } = run.worker();
      await worker.start();
      const [launch] = run.launches() as Record<string, string | string[] | boolean>[];
      const runId = String(launch!['NGN_RUN_ID']);
      assert.match(runId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(launch!['argv'], [
        linuxBundleUrl(8099),
        '--app-id',
        testApplicationId(runId),
      ]);
      assert.equal(launch!['NGN_TESTS'], '1');
      assert.equal(launch!['NGN_TESTS_FAKE_SYSTEM_UI'], '1');
      const state = String(launch!['NGN_STATE_DIR']);
      for (const [name, folder] of [
        ['XDG_DATA_HOME', 'data'],
        ['XDG_CONFIG_HOME', 'config'],
        ['XDG_CACHE_HOME', 'cache'],
        ['XDG_STATE_HOME', 'state'],
        ['TMPDIR', 'tmp'],
      ] as const) {
        assert.equal(launch![name], join(state, folder), `${name} is under the state directory`);
      }
      assert.equal(launch!['made'], true, 'each folder exists as the host starts');
      worker.send(request('cancel') as never);
      await wait(300);
      assert.ok(run.launches().some((entry) => entry['got'] === 'cancel'));
      await worker.stop();
      assert.ok(
        run.launches().some((entry) => entry['terminated'] === runId),
        'SIGTERM reached the host through the session script',
      );
      assert.equal(existsSync(state), false, 'the state is removed with the host');
      assert.deepEqual(
        messages.filter((message) => message.error),
        [],
      );
    } finally {
      await run.done();
    }
  });

  it("fails the file a crash interrupted with the signal and the host's last output, and runs the next on a new host", async () => {
    const run = await setup({ crash: true });
    try {
      const { worker, messages } = run.worker();
      await worker.start();
      worker.send(request('cancel') as never);
      await wait(1500);
      const failed = messages.find((message) => message.error);
      assert.match(String(failed?.error?.message), /The app exited \(signal SIGKILL\)/);
      assert.match(
        String(failed?.error?.message),
        /The host's last output:\nGdk-ERROR: stand-in for the host aborting/,
      );
      // Its crash.txt, which the session prints as the host goes, before the state goes with it.
      assert.match(
        String(failed?.error?.message),
        /The host's crash report:\nngn-linux crashed: SIGSEGV \(signal 11\)\nNative stack:\n#0 stand-in/,
      );
      assert.doesNotMatch(
        String(failed?.error?.message),
        /last output:[\s\S]*the host left crash\.txt/,
      );

      worker.send(request('cancel') as never);
      await wait(800);
      const starts = run.launches().filter((entry) => entry['NGN_RUN_ID']);
      assert.equal(starts.length, 2, 'the host was started again');
      assert.notEqual(starts[0]!['NGN_STATE_DIR'], starts[1]!['NGN_STATE_DIR']);
      assert.notEqual(
        (starts[0]!['argv'] as string[]).at(-1),
        (starts[1]!['argv'] as string[]).at(-1),
        'each launch has its own app id',
      );
    } finally {
      await run.done();
    }
  });

  it('ends a host that ignores SIGTERM together with what it started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linux-stubborn-'));
    const pids = join(dir, 'pids');
    const script = join(dir, 'host.cjs');
    writeFileSync(
      script,
      `const { spawn } = require('node:child_process');
process.on('SIGTERM', () => {});
const child = spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(process.env.PIDS, process.pid + ' ' + child.pid);
setInterval(() => {}, 1000);`,
    );
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      const app = await linuxLauncher({
        host: process.execPath,
        args: [script],
        display: 'inherit',
        container: false,
        fakeSystemUi: false,
        env: { PIDS: pids },
      }).start({
        port: 1,
        metroPort: 8099,
        projectRoot: '/p',
        runId: 'stubborn',
        stateDir: join(dir, 'state'),
      });
      for (let i = 0; i < 100 && !existsSync(pids); i++) await wait(50);
      const [host, grandchild] = readFileSync(pids, 'utf8').split(' ').map(Number) as [
        number,
        number,
      ];
      assert.ok(alive(host!) && alive(grandchild!));
      await app.stop();
      await wait(200);
      assert.equal(alive(host!), false, 'the host is gone');
      assert.equal(alive(grandchild!), false, 'what it started is gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails the start when the host ends before it connects, with its status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linux-pool-'));
    try {
      const pool = devicePool({
        port: await freePort(),
        platform: 'linux',
        metroPort: 8099,
        connectTimeout: 5000,
        launch: linuxLauncher({
          host: process.execPath,
          args: ['-e', 'process.exit(3)', '--'],
          display: 'inherit',
          container: false,
          fakeSystemUi: false,
        }),
      });
      const worker = pool.createPoolWorker({ project: { config: { root: dir } } } as never);
      await assert.rejects(worker.start(), /exited before it connected \(status 3\)/);
      await worker.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks for the host when none is given', () => {
    assert.throws(
      () =>
        linuxLaunchCommand(
          {},
          { port: 1, metroPort: 8099, projectRoot: '/p', runId: 'r', stateDir: '/s' },
          {},
        ),
      /needs the Linux desktop host: pass `host`.*or set NGN_DESKTOP_HOST/,
    );
  });

  it('asks the project’s desktop CLI for the host, as npm run linux gets it, and fails closed', () => {
    const asked: unknown[] = [];
    const answer =
      (result: object) =>
      (...args: unknown[]) => {
        asked.push(args);
        return { status: 0, stdout: '', stderr: '', ...result } as never;
      };
    assert.equal(
      desktopCliHost(
        '/app',
        'ng-native-desktop',
        answer({ stdout: '/cache/rn-0.88.0/prebuilt/abc/gtk/ngn-linux\n' }),
      ),
      '/cache/rn-0.88.0/prebuilt/abc/gtk/ngn-linux',
    );
    assert.deepEqual((asked[0] as unknown[]).slice(0, 2), [
      'ng-native-desktop',
      ['host', '--os', 'linux'],
    ]);
    assert.equal((asked[0] as [unknown, unknown, { cwd: string }])[2].cwd, '/app');
    assert.throws(
      () =>
        desktopCliHost(
          '/app',
          'ng-native-desktop',
          answer({ status: 2, stderr: 'no prebuilt Linux arm64 host fits' }),
        ),
      /could not get the Linux desktop host from ng-native-desktop host --os linux: no prebuilt Linux arm64 host fits/,
    );
    // A command that printed nothing gives no host, whatever its status.
    assert.throws(() => desktopCliHost('/app', 'ng-native-desktop', answer({})), /could not get/);
    assert.throws(
      () =>
        desktopCliHost(
          '/app',
          'ng-native-desktop',
          answer({ status: null, error: new Error('spawn ENOENT') }),
        ),
      /spawn ENOENT/,
    );
  });

  it('gives each launch an app id GApplication accepts', () => {
    const id = testApplicationId('6f1c2a3b-0d4e-4f5a-9b6c-7d8e9f0a1b2c');
    assert.equal(id, 'dev.ngnative.tests.run_6f1c2a3b_0d4e_4f5a_9b6c_7d8e9f0a1b2c');
    // g_application_id_is_valid: two or more elements of [A-Za-z0-9_-], none starting with a digit.
    assert.match(id, /^([A-Za-z_][A-Za-z0-9_]*)(\.[A-Za-z_-][A-Za-z0-9_-]*)+$/);
    assert.ok(id.length <= 255);
  });
});

describe('the Linux launch from another OS', () => {
  const runRequest = {
    port: 51730,
    metroPort: 8099,
    projectRoot: '/p',
    runId: 'r-1',
    stateDir: '/var/folders/x/state',
  };

  it('runs the host in the AlmaLinux 9 image, on a display of its own, forwarding the pool and Metro', () => {
    const launch = linuxLaunchCommand(
      {
        host: '/Users/me/cache/build/gtk/ngn-linux',
        container: 'ngn-el9',
        metroPort: 8082,
        fakeSystemUi: false,
      },
      runRequest,
      {},
    );
    assert.equal(launch.command, 'docker');
    assert.equal(launch.container, 'ngn-test-r-1');
    const args = launch.args;
    assert.deepEqual(args.slice(0, 5), ['run', '--rm', '--init', '--name', 'ngn-test-r-1']);
    assert.ok(args.includes('/Users/me/cache/build:/Users/me/cache/build:ro'), 'the build mounted');
    const image = args.indexOf('ngn-el9');
    assert.ok(image > 0);
    assert.ok(args.includes('NGN_STATE_DIR=/tmp/ngn-state'), 'state kept inside the container');
    assert.ok(args.includes('XDG_CACHE_HOME=/tmp/ngn-state/cache'));
    assert.ok(
      !args.some((arg) => arg.includes('/var/folders')),
      'no path the container cannot see',
    );
    assert.equal(args[image + 3], sessionScript('weston', [51730, 8082]));
    assert.deepEqual(args.slice(image + 4), [
      'ngn-test',
      '/Users/me/cache/build/gtk/ngn-linux',
      linuxBundleUrl(8082),
      '--app-id',
      testApplicationId('r-1'),
    ]);
  });

  it('starts a container with a fake system UI as root, and runs the session as the caller', () => {
    const { args } = linuxLaunchCommand(
      { host: '/Users/me/cache/build/gtk/ngn-linux', container: 'ngn-el9', metroPort: 8082 },
      runRequest,
      {},
    );
    // As root even where the image names another user: root makes the passwd entry.
    assert.equal(args[args.indexOf('--user') + 1], '0:0');
    assert.ok(args.indexOf('--user') < args.indexOf('ngn-el9'));
    const user = `${process.getuid?.()}:${process.getgid?.()}`;
    assert.ok(args.includes(`NGN_AS_USER=${user}`), 'and drops to the caller (ROOT_PRELUDE)');
    assert.ok(args.includes(`NGN_FAKE_PORTALS=${FAKE_PORTALS}`));
    assert.ok(args.includes(`${dirname(FAKE_PORTALS)}:${dirname(FAKE_PORTALS)}:ro`));
    const image = args.indexOf('ngn-el9');
    assert.deepEqual(args.slice(image + 1, image + 5), ['bash', '-c', ROOT_PRELUDE, 'ngn-prelude']);
    assert.equal(args[image + 5], sessionScript('weston', [51730, 8082], true));
    assert.match(args[image + 5] ?? '', /dbus-daemon --config-file/);
    // Without one, the caller is the container's user and nothing is faked.
    const plain = linuxLaunchCommand(
      { host: '/h/b/gtk/ngn-linux', container: 'ngn-el9', fakeSystemUi: false },
      runRequest,
      {},
    );
    assert.equal(plain.args[plain.args.indexOf('--user') + 1], user);
    assert.ok(!plain.args.some((arg) => arg.startsWith('NGN_FAKE_PORTALS')));
    assert.doesNotMatch(plain.args.join('\n'), /dbus-daemon/);
  });

  it('runs in the image NGN_LINUX_IMAGE names, and in ngn-el9 without it', () => {
    assert.equal(imageNamed({}), 'ngn-el9');
    assert.equal(imageNamed({ NGN_LINUX_IMAGE: 'ngn-fedora' }), 'ngn-fedora');
    assert.equal(
      imageNamed({ NGN_LINUX_IMAGE: 'registry.example/ngn/fedora:44' }),
      'registry.example/ngn/fedora:44',
    );
    // An empty value, or one docker would take for an option, is a mistake and not the default.
    for (const bad of ['', '-v /:/host', 'ngn fedora']) {
      assert.throws(() => imageNamed({ NGN_LINUX_IMAGE: bad }), /not an image name/);
    }
    // The default container, off Linux: the platform is the launcher's, so it is set for the call.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const request = { host: '/Users/me/b/gtk/ngn-linux' };
      for (const [env, expected] of [
        [{}, 'ngn-el9'],
        [{ NGN_LINUX_IMAGE: 'ngn-fedora' }, 'ngn-fedora'],
      ] as const) {
        const { args } = linuxLaunchCommand(request, runRequest, env);
        assert.equal(args[args.indexOf('bash') - 1], expected);
      }
      // A launcher given a container ignores the variable.
      const given = linuxLaunchCommand({ ...request, container: 'ngn-el9' }, runRequest, {
        NGN_LINUX_IMAGE: 'ngn-fedora',
      });
      assert.equal(given.args[given.args.indexOf('bash') - 1], 'ngn-el9');
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('maps host.docker.internal for Docker Engine on Linux, which does not define it', () => {
    const { args } = linuxLaunchCommand(
      { host: '/cache/build/gtk/ngn-linux', container: 'ngn-el9', metroPort: 8082 },
      runRequest,
      {},
    );
    const at = args.indexOf('--add-host');
    assert.ok(at > 0 && at < args.indexOf('ngn-el9'));
    assert.equal(args[at + 1], 'host.docker.internal:host-gateway');
  });

  it("mounts a bundle file's folder, which the container could not see otherwise", () => {
    const { args } = linuxLaunchCommand(
      {
        host: '/h/b/gtk/ngn-linux',
        container: 'ngn-el9',
        bundle: '/Users/me/out/main.js',
        fakeSystemUi: false,
      },
      runRequest,
      {},
    );
    assert.ok(args.includes('/h/b:/h/b:ro'));
    assert.ok(args.includes('/Users/me/out:/Users/me/out:ro'));
    assert.equal(args.at(-3), '/Users/me/out/main.js');
  });

  it('refuses to inherit a display into a container', () => {
    assert.throws(
      () =>
        linuxLaunchCommand(
          { host: '/h/b/gtk/ngn-linux', container: 'ngn-el9', display: 'inherit' },
          runRequest,
          {},
        ),
      /a container has no display to inherit/,
    );
  });

  it('starts the display it is asked for, and forwards only in a container', () => {
    const direct = linuxLaunchCommand(
      { host: '/h/b/gtk/ngn-linux', container: false, fakeSystemUi: false },
      runRequest,
      { DISPLAY: ':0' },
    );
    assert.equal(direct.command, 'bash');
    assert.equal(direct.args[1], sessionScript('inherit'), 'a display already there is used');
    const headless = linuxLaunchCommand(
      { host: '/h/b/gtk/ngn-linux', container: false, fakeSystemUi: false },
      runRequest,
      {},
    );
    assert.equal(headless.args[1], sessionScript('weston'), 'Weston where there is no display');
    assert.match(sessionScript('xvfb'), /Xvfb -displayfd 3 .*\n[\s\S]*GDK_BACKEND=x11/);
    assert.match(sessionScript('weston'), /headless="--backend=headless --renderer=pixman"/);
    assert.match(sessionScript('weston'), /headless="--backend=headless-backend\.so --use-pixman"/);
    assert.doesNotMatch(sessionScript('inherit'), /Xvfb|weston|node -e/);
    assert.match(sessionScript('weston', [51730]), /node -e [\s\S]* 51730 &/);
  });
});

describe('the linux Vitest project', () => {
  it("asks the desktop CLI from the project's root, not the folder Vitest was started in", async () => {
    const savedHost = process.env['NGN_DESKTOP_HOST'];
    const savedPath = process.env['PATH'];
    delete process.env['NGN_DESKTOP_HOST'];
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'linux-root-')));
    const bin = join(dir, 'bin');
    const app = join(dir, 'app');
    mkdirSync(bin);
    mkdirSync(app);
    writeFileSync(
      join(bin, 'ng-native-desktop'),
      `#!/bin/sh\npwd > ${JSON.stringify(join(dir, 'cwd'))}\necho ${JSON.stringify(join(dir, 'no-host'))}\n`,
    );
    chmodSync(join(bin, 'ng-native-desktop'), 0o755);
    process.env['PATH'] = `${bin}${delimiter}${savedPath}`;
    try {
      const { pool } = (
        deviceTests({
          platform: 'linux',
          port: await freePort(),
          // Metro runs elsewhere: what this asks of is the host.
          metroPort: 8099,
          connectTimeout: 500,
        }).config as (config: object) => { test: { pool: ReturnType<typeof devicePool> } }
      )({ root: app }).test;
      const worker = pool.createPoolWorker({ project: { config: { root: app } } } as never);
      await assert.rejects(worker.start());
      await worker.stop();
      assert.equal(readFileSync(join(dir, 'cwd'), 'utf8').trim(), app);
    } finally {
      process.env['PATH'] = savedPath;
      if (savedHost === undefined) delete process.env['NGN_DESKTOP_HOST'];
      else process.env['NGN_DESKTOP_HOST'] = savedHost;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const configOf = (options: Parameters<typeof deviceTests>[0]) =>
    (
      deviceTests(options).config as (config: object) => {
        test: { name: string; resolveSnapshotPath?: (path: string, extension: string) => string };
      }
    )({ root: tmpdir() }).test;

  it('is named linux, so vitest --project linux selects it, and keeps its own snapshots', () => {
    assert.equal(configOf({ platform: 'linux' }).name, 'linux');
    assert.equal(
      configOf({ platform: 'linux' }).resolveSnapshotPath!('/app/src/row.device.ts', '.snap'),
      '/app/src/__snapshots__/row.device.ts.linux.snap',
    );
  });

  it('starts the GTK host itself, as the macos project starts the AppKit one', async () => {
    const saved = process.env['NGN_DESKTOP_HOST'];
    delete process.env['NGN_DESKTOP_HOST'];
    const dir = mkdtempSync(join(tmpdir(), 'linux-pool-'));
    try {
      const { pool } = (
        deviceTests({
          platform: 'linux',
          port: await freePort(),
          // Metro runs elsewhere: what this asks of is the host.
          metroPort: 8099,
          connectTimeout: 1000,
        }).config as (config: object) => { test: { pool: ReturnType<typeof devicePool> } }
      )({ root: dir }).test;
      const worker = pool.createPoolWorker({ project: { config: { root: dir } } } as never);
      // The launcher asks the desktop CLI for the host, which has none for an empty folder, where a
      // pool with no launcher would wait for an app to connect.
      await assert.rejects(worker.start(), /could not get the Linux desktop host/);
      await worker.stop();
    } finally {
      if (saved === undefined) delete process.env['NGN_DESKTOP_HOST'];
      else process.env['NGN_DESKTOP_HOST'] = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
