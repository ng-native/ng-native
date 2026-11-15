/**
 * The Node half of in-app tests on a Mac: `vitest --project macos` runs a project whose pool opens
 * the desktop host itself and treats it as one more session platform. Here the host is a stand-in
 * script that does what the real one's contract says (`launcher.ts` in `@ng-native/testing`), so
 * these tests hold the pool, the launcher and the Vitest plugin to that contract with no host.
 *
 * THE CONTRACT THE DESKTOP HOST MUST IMPLEMENT
 *
 * 1. Launch. `ng-native-desktop run --port <metro port>` is run with `NGN_TESTS=1`,
 *    `NGN_STATE_DIR` (a new empty directory), `NGN_RUN_ID` (a UUID, unique per launch) and
 *    `NGN_TESTS_FAKE_SYSTEM_UI=1` in its environment, and the CLI passes the environment to the
 *    host. With `NGN_TESTS`, the host opens its windows on screen without activating the app or
 *    taking focus, and keeps its Dock icon hidden until a test asks for the key window. All its
 *    state (Application Support, Caches, tmp, a `UserDefaults` suite named by the run id) lives
 *    under `NGN_STATE_DIR`, and its Keychain items are namespaced by the run id and deleted on
 *    exit. System UI (open and save panels, permission prompts, Touch ID) answers as a person
 *    cancelling or denying would, at once.
 * 2. Session. The app's JavaScript, `startDeviceTests()` from `@ng-native/testing/device/host`,
 *    long-polls `POST http://127.0.0.1:51730/poll` with `{ session, platform: 'macos', script,
 *    defined, hashes, reply }` and is sent Vitest's worker requests, exactly as on iOS and
 *    Android. It posts runner calls to `/rpc` and snapshot file operations to `/files`. The
 *    metro bundle URL it sends in `script` is the dev server's, so the pool fetches test bundles
 *    from the same Metro the host loaded (dev builds only; the flag is
 *    `EXPO_PUBLIC_DEVICE_TESTS` on Metro). `Platform.OS` is `macos`, so `platform: 'macos'`.
 * 3. Exit. The host exits when sent SIGTERM, within three seconds. It exits with its own status.
 *    A crash leaves `~/Library/Logs/DiagnosticReports/ngn-macos-*.ips`; a process that ends while
 *    the pool is waiting on an answer fails the running file, with that report named in the
 *    failure, and the pool starts a new host on new state for the files that remain.
 *
 * A session that stops polling without the process ending (a hang) is failed by the pool after
 * `appTimeout` (15 seconds), as on a device; the host sends a poll at least once a second while
 * its JavaScript is not blocked.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  crashReportSince,
  macosLauncher,
  testEnvironment,
} from '@ng-native/testing/device/macos-launcher';
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
 * A stand-in host: records its launch (environment and the state directory's contents), polls the
 * pool as a macOS app, and ends as the test says: on SIGTERM, or by killing itself on the first
 * request when asked to crash, after writing a crash report.
 */
const HOST = `
const fs = require('node:fs');
const env = process.env;
const launch = {
  argv: process.argv.slice(2),
  NGN_TESTS: env.NGN_TESTS,
  NGN_STATE_DIR: env.NGN_STATE_DIR,
  NGN_RUN_ID: env.NGN_RUN_ID,
  NGN_TESTS_FAKE_SYSTEM_UI: env.NGN_TESTS_FAKE_SYSTEM_UI,
  stateEntries: fs.readdirSync(env.NGN_STATE_DIR),
};
fs.appendFileSync(env.LOG, JSON.stringify(launch) + '\\n');
fs.writeFileSync(env.NGN_STATE_DIR + '/state', 'x');
process.on('SIGTERM', () => process.exit(0));
const session = 'mac-' + env.NGN_RUN_ID;
let reply = null;
(async () => {
  for (;;) {
    const response = await fetch('http://127.0.0.1:' + env.POOL_PORT + '/poll', {
      method: 'POST',
      body: JSON.stringify({ session, platform: 'macos', script: 'http://127.0.0.1:1/i.bundle?platform=macos', defined: [], hashes: {}, reply }),
    });
    const request = await response.json();
    reply = null;
    if (!request) continue;
    fs.appendFileSync(env.LOG, JSON.stringify({ got: request.type, session }) + '\\n');
    if (request.type === 'cancel' && env.CRASH_FIRST && !fs.existsSync(env.CRASH_FIRST)) {
      fs.writeFileSync(env.CRASH_FIRST, '1');
      fs.writeFileSync(env.REPORTS + '/ngn-macos-2026-11-14.ips', 'crash');
      process.kill(process.pid, 'SIGKILL');
    }
    reply = { __vitest_worker_response__: true, type: 'testfileFinished' };
  }
})();
`;

async function setup(options: { crash?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'macos-pool-'));
  const reports = join(dir, 'reports');
  mkdirSync(reports);
  const log = join(dir, 'launches.log');
  writeFileSync(log, '');
  const script = join(dir, 'host.cjs');
  writeFileSync(script, HOST);
  const port = await freePort();
  const launch = macosLauncher({
    command: process.execPath,
    args: [script],
    metroPort: 8099,
    reports,
    reportWait: 500,
    env: {
      LOG: log,
      POOL_PORT: String(port),
      REPORTS: reports,
      ...(options.crash ? { CRASH_FIRST: join(dir, 'crashed') } : {}),
    },
  });
  const pool = devicePool({
    port,
    platform: 'macos',
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
  return { dir, reports, worker, launches, done };
}

const request = (type: string) => ({ __vitest_worker_request__: true, type, context: {} });

describe('the macOS launcher', () => {
  it('starts the host with the test environment on a fresh state directory, and removes it', async () => {
    const run = await setup();
    try {
      const { worker, messages } = run.worker();
      await worker.start();
      const [launch] = run.launches() as Record<string, string | string[]>[];
      assert.deepEqual(launch!['argv'], ['run', '--port', '8099']);
      assert.equal(launch!['NGN_TESTS'], '1');
      assert.equal(launch!['NGN_TESTS_FAKE_SYSTEM_UI'], '1');
      assert.match(String(launch!['NGN_RUN_ID']), /^[0-9a-f-]{36}$/);
      assert.deepEqual(launch!['stateEntries'], [], 'the state directory is empty at launch');
      const state = String(launch!['NGN_STATE_DIR']);
      await wait(100);
      assert.ok(existsSync(state), 'the host has it while it runs');
      worker.send(request('cancel') as never);
      await wait(300);
      assert.equal(
        run.launches().some((entry) => entry['got'] === 'cancel'),
        true,
        'the macOS session got the request',
      );
      await worker.stop();
      assert.equal(existsSync(state), false, 'the state is removed with the host');
      assert.deepEqual(
        messages.filter((message) => message.error),
        [],
      );
    } finally {
      await run.done();
    }
  });

  it('fails the file a crash interrupted with the crash report, and runs the next on a new host and new state', async () => {
    const run = await setup({ crash: true });
    try {
      const { worker, messages } = run.worker();
      await worker.start();
      worker.send(request('cancel') as never);
      await wait(1500);
      const failed = messages.find((message) => message.error);
      assert.match(String(failed?.error?.message), /The app exited \(signal SIGKILL\)/);
      assert.match(String(failed?.error?.message), /Crash report: .*ngn-macos-2026-11-14\.ips/);
      assert.equal(failed?.type, 'testfileFinished');

      worker.send(request('cancel') as never);
      await wait(800);
      const launches = run.launches();
      const starts = launches.filter((entry) => entry['NGN_RUN_ID']);
      assert.equal(starts.length, 2, 'the host was started again');
      assert.notEqual(starts[0]!['NGN_RUN_ID'], starts[1]!['NGN_RUN_ID']);
      assert.notEqual(starts[0]!['NGN_STATE_DIR'], starts[1]!['NGN_STATE_DIR']);
      assert.deepEqual(starts[1]!['stateEntries'], [], 'the new host starts on empty state');
      const second = launches.filter((entry) => entry['got'] === 'cancel').at(-1)!;
      assert.equal(
        second['session'],
        `mac-${String(starts[1]!['NGN_RUN_ID'])}`,
        'the next file ran on it',
      );
    } finally {
      await run.done();
    }
  });

  it('fails the start when the host ends before it connects, with how it ended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'macos-pool-'));
    try {
      const pool = devicePool({
        port: await freePort(),
        platform: 'macos',
        connectTimeout: 5000,
        launch: macosLauncher({
          command: process.execPath,
          args: ['-e', 'process.exit(3)'],
          reports: dir,
          reportWait: 0,
        }),
      });
      const worker = pool.createPoolWorker({ project: { config: { root: dir } } } as never);
      await assert.rejects(worker.start(), /exited before it connected \(status 3\)/);
      await worker.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the test environment from the request', () => {
    assert.deepEqual(testEnvironment({ port: 1, runId: 'r', stateDir: '/s' }), {
      NGN_TESTS: '1',
      NGN_STATE_DIR: '/s',
      NGN_RUN_ID: 'r',
      NGN_TESTS_FAKE_SYSTEM_UI: '1',
    });
  });
});

describe('finding the crash report', () => {
  it("takes the newest report for the host's executable written since the launch", () => {
    const dir = mkdtempSync(join(tmpdir(), 'reports-'));
    try {
      const at = (name: string, seconds: number) => {
        writeFileSync(join(dir, name), 'x');
        utimesSync(join(dir, name), seconds, seconds);
      };
      at('ngn-macos-old.ips', 100);
      at('ngn-macos-a.ips', 1000);
      at('ngn-macos-b.crash', 2000);
      at('Safari-c.ips', 3000);
      assert.equal(
        crashReportSince(dir, 'ngn-macos', 500_000),
        join(dir, 'ngn-macos-b.crash').replace(/^/, 'Crash report: '),
      );
      assert.equal(
        crashReportSince(dir, 'ngn-macos', 5_000_000),
        undefined,
        'none since a later launch',
      );
      assert.equal(crashReportSince(join(dir, 'missing'), 'ngn-macos', 0), undefined);
      assert.deepEqual(readdirSync(dir).length, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the macos Vitest project', () => {
  const configOf = (options: Parameters<typeof deviceTests>[0]) =>
    (
      deviceTests(options).config as (config: object) => {
        test: {
          name: string;
          pool: { name: string };
          resolveSnapshotPath?: (path: string, extension: string) => string;
        };
      }
    )({ root: tmpdir() }).test;

  it('is named for its platform, so vitest --project macos selects it', () => {
    assert.equal(configOf({ platform: 'macos' }).name, 'macos');
    assert.equal(configOf({ platform: 'ios' }).name, 'ios');
    assert.equal(configOf({}).name, 'device');
    assert.equal(configOf({ platform: 'macos', name: 'desktop' }).name, 'desktop');
    assert.equal(configOf({ platform: 'macos' }).pool.name, 'device');
  });

  it('keeps a snapshot file per platform, beside the test as Vitest does', () => {
    const resolve = (options: Parameters<typeof deviceTests>[0]) =>
      configOf(options).resolveSnapshotPath;
    assert.equal(
      resolve({ platform: 'macos' })!('/app/src/row.device.ts', '.snap'),
      '/app/src/__snapshots__/row.device.ts.macos.snap',
    );
    assert.equal(
      resolve({ platform: 'ios' })!('/app/src/row.device.ts', '.snap'),
      '/app/src/__snapshots__/row.device.ts.ios.snap',
    );
    assert.equal(resolve({}), undefined, 'Vitest default for a project with no platform');
  });
});
