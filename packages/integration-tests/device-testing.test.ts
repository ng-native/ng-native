/**
 * `@ng-native/testing/device`: the Vitest pool whose workers are apps on devices, the reading of a
 * Metro bundle it sends them from, and the Metro config's two modes.
 *
 * An app is a stand-in here that speaks the test host's side of the protocol over HTTP, as the real
 * one does from a device, and Metro is a stand-in that serves one bundle.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { dependents, modulesOf, scriptOf } from '@ng-native/testing/device/bundle-modules';
import { mockedSpecifiers } from '@ng-native/testing/device/mocks';
import { devicePool } from '@ng-native/testing/device/pool';

const define = (id: number, deps: number[], name: string, body = '') =>
  `__d(function (global, require) {\n  ${body}\n},${id},[${deps.join(',')}],${JSON.stringify(name)});`;

describe("reading a Metro bundle's modules", () => {
  it('finds each module with its id, name, code and line, and leaves the run call out', () => {
    const text = [
      define(1, [2], 'src/a.ts', `const s = '},9,[1],"fake");';`),
      define(2, [], 'src/b "quoted".ts'),
      '__r(1);\n//# sourceURL=http://localhost/a.bundle',
    ].join('\n');
    const modules = modulesOf(text);
    assert.deepEqual(
      modules.map(({ id, name, line }) => ({ id, name, line })),
      [
        { id: 1, name: 'src/a.ts', line: 0 },
        { id: 2, name: 'src/b "quoted".ts', line: 3 },
      ],
    );
    assert.ok(
      modules[0]!.code.includes('const s ='),
      'the code a lookalike in a string is kept in',
    );
    assert.ok(!modules.some((mod) => mod.code.includes('__r(')), 'the run call is no module');
  });

  it('puts each module back on its line in the bundle, under the bundle URL', () => {
    const text = [define(1, [], 'src/a.ts'), define(2, [], 'src/b.ts'), define(3, [], 'src/c.ts')];
    const modules = modulesOf(text.join('\n'));
    const script = scriptOf([modules[2]!, modules[0]!], 'http://metro/a.bundle');
    const lines = script.split('\n');
    assert.equal(lines[0], text[0]!.split('\n')[0], 'the first module on line 1');
    assert.equal(lines[modules[2]!.line], text[2]!.split('\n')[0], 'the third on its own line');
    assert.equal(lines.at(-1), '//# sourceURL=http://metro/a.bundle');
  });

  it('walks every importer of a changed module, whichever shape its imports are in', () => {
    const modules = new Map([
      [1, { dependencyMap: [2] }],
      [2, { dependencyMap: { a: 3 } }],
      [3, { dependencyMap: [] }],
      [4, { dependencyMap: [5] }],
      [5, {}],
    ]);
    assert.deepEqual([...dependents(modules, new Set([3]))].sort(), [1, 2]);
    assert.deepEqual([...dependents(modules, new Set([5]))], [4]);
  });

  it('reads the specifiers a test mocks, in each form vi takes them', () => {
    const source = `
      vi.mock('./a.ts', () => ({}));
      vi.mock("../b", async (importOriginal) => importOriginal());
      vi.doMock(\`pkg\`);
      vi.mock(import('./c.ts'));
      await vi.importActual('./a.ts');
      notvi.mock('./ignored');
    `;
    assert.deepEqual(mockedSpecifiers(source), ['./a.ts', '../b', 'pkg', './c.ts']);
  });
});

/** A port nothing is listening on. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A project with a test that mocks its neighbour, a stand-in Metro that serves the test's bundle
 * (`bundle` is what it serves), and a pool whose workers' messages to Vitest are collected.
 */
async function setup(options: Parameters<typeof devicePool>[0] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'device-pool-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.device.ts'), "vi.mock('./dep.ts', () => ({}));\n");
  writeFileSync(join(root, 'src/dep.ts'), 'export const x = 1;\n');
  const served = {
    bundle: [
      define(10, [11, 12], 'src/a.device.ts'),
      define(11, [], 'src/dep.ts', 'exports.x = 1;'),
      define(12, [], 'node_modules/x/index.js'),
    ].join('\n'),
  };
  const metro: Server = createHttpServer((request, response) => {
    if (request.url?.startsWith('/src/a.device.bundle')) response.end(served.bundle);
    else response.writeHead(404).end('{"message":"not found"}');
  });
  await new Promise<void>((resolve) => metro.listen(0, '127.0.0.1', resolve));
  const metroPort = (metro.address() as { port: number }).port;

  const port = options.port ?? (await freePort());
  const pool = devicePool({ connectTimeout: 2000, ...options, port, serverRoot: root });
  // The stand-in apps' requests, which the pool may hold open: aborted when the test is done, or
  // they would keep the test process running.
  const requests = new AbortController();
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: requests.signal,
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const app = (session: string, platform = 'ios') => ({
    poll: (state: { reply?: unknown; defined?: number[]; hashes?: Record<string, string> } = {}) =>
      post('/poll', {
        session,
        platform,
        script: `http://127.0.0.1:${metroPort}/index.bundle?platform=${platform}&dev=true`,
        defined: state.defined ?? [],
        hashes: state.hashes ?? {},
        reply: state.reply ?? null,
      }),
    post: (path: string, body: Record<string, unknown>) => post(path, { session, ...body }),
  });
  const workers: ReturnType<typeof pool.createPoolWorker>[] = [];
  const worker = () => {
    const made = pool.createPoolWorker({ project: { config: { root } } } as never);
    const messages: unknown[] = [];
    made.on('message', (message) => void messages.push(message));
    workers.push(made);
    return { worker: made, messages };
  };
  const done = async () => {
    requests.abort();
    for (const made of workers) await made.stop();
    await new Promise((resolve) => metro.close(resolve));
    rmSync(root, { recursive: true, force: true });
  };
  return { root, served, app, worker, done, port };
}

const request = (type: string, context: unknown = {}) => ({
  __vitest_worker_request__: true,
  type,
  context,
});

describe('the device pool', () => {
  it('sends the app only the modules it lacks or has an old version of, and what the test mocks', async () => {
    const run = await setup();
    try {
      const phone = run.app('one');
      const { worker } = run.worker();
      const starting = worker.start();
      const first = phone.poll({ defined: [12] });
      await starting;
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      const asked = await first;
      const payload = asked.files[test];
      assert.equal(payload.entry, 10);
      assert.deepEqual(
        payload.modules.map(({ id }: { id: number }) => id),
        [10, 11],
        'not the module the app already has',
      );
      assert.deepEqual(payload.changed, []);
      assert.deepEqual(payload.mocks, { './dep.ts': 11 });

      // The app now has both, and an edit to the neighbour reaches Metro.
      const hashes = Object.fromEntries(
        payload.modules.map(({ id, hash }: { id: number; hash: string }) => [id, hash]),
      );
      run.served.bundle = run.served.bundle.replace('exports.x = 1;', 'exports.x = 2;');
      const second = phone.poll({
        reply: { __vitest_worker_response__: true, type: 'testfileFinished' },
        defined: [10, 11, 12],
        hashes,
      });
      await wait(50);
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      const again = (await second).files[test];
      assert.deepEqual(again.changed, [11]);
      assert.deepEqual(
        again.modules.map(({ id }: { id: number }) => id),
        [11],
      );
    } finally {
      await run.done();
    }
  });

  it('tells the app why a file cannot run when Metro cannot bundle it', async () => {
    const run = await setup();
    try {
      const phone = run.app('one');
      const { worker } = run.worker();
      const starting = worker.start();
      const first = phone.poll();
      await starting;
      const missing = join(run.root, 'src/missing.device.ts');
      worker.send(request('run', { files: [{ filepath: missing }] }) as never);
      assert.match((await first).files[missing].error, /could not bundle src\/missing\.device\.ts/);
    } finally {
      await run.done();
    }
  });

  it('gives a worker asking for a platform an app on that platform', async () => {
    const run = await setup({ platform: 'android' });
    try {
      void run
        .app('phone', 'ios')
        .poll()
        .catch(() => {});
      const android = run.app('emulator', 'android').poll();
      const { worker } = run.worker();
      await worker.start();
      worker.send(request('cancel') as never);
      const asked = await Promise.race([android, wait(1000).then(() => ({ type: 'nothing' }))]);
      assert.equal(asked.type, 'cancel', 'the request went to the Android app');
    } finally {
      await run.done();
    }
  });

  it('fails the request an app owed when it relaunched, rather than waiting it out', async () => {
    const run = await setup();
    try {
      const { worker, messages } = run.worker();
      const starting = worker.start();
      const first = run.app('before').poll();
      await starting;
      worker.send(request('cancel') as never);
      await first;
      await wait(2600);
      void run
        .app('after')
        .poll()
        .catch(() => {});
      await wait(50);
      const [failed] = messages as { error?: Error }[];
      assert.match(String(failed?.error?.message), /restarted during the run/);
    } finally {
      await run.done();
    }
  });

  it('fails the request when the app goes quiet, as a closed or crashed app does', async () => {
    const run = await setup({ appTimeout: 300 });
    try {
      const { worker, messages } = run.worker();
      const starting = worker.start();
      const first = run.app('one').poll();
      await starting;
      worker.send(request('cancel') as never);
      await first;
      await wait(600);
      const [failed] = messages as { error?: Error }[];
      assert.match(String(failed?.error?.message), /stopped answering/);
    } finally {
      await run.done();
    }
  });

  it("answers the app's runner calls with Vitest's answers, its task trees linked up again", async () => {
    const run = await setup();
    try {
      const phone = run.app('one');
      const { worker, messages } = run.worker();
      const starting = worker.start();
      void phone.poll().catch(() => {});
      await starting;
      const file = { id: 'f', type: 'suite', tasks: [{ id: 't', type: 'test' }] };
      const queued = phone.post('/rpc', { call: { t: 'q', m: 'onQueued', a: [file], i: 'q-1' } });
      const answered = phone.post('/rpc', {
        call: { t: 'q', m: 'onCollected', a: [[file]], i: 'q-2' },
      });
      await wait(50);
      const [queuedCall, collectedCall] = messages as {
        a: unknown[];
      }[];
      const onQueued = queuedCall!.a[0] as { file: unknown; tasks: { file: unknown }[] };
      assert.equal(onQueued.file, onQueued, 'onQueued: a file is its own file');
      const collected = (
        collectedCall!.a[0] as { file: unknown; tasks: { suite: unknown }[] }[]
      )[0]!;
      assert.equal(collected.file, collected);
      assert.equal(collected.tasks[0]!.suite, collected, 'onCollected: a test is in its file');
      worker.send({ t: 's', i: 'q-1', r: null } as never);
      worker.send({ t: 's', i: 'q-2', r: 'ok' } as never);
      await queued;
      assert.deepEqual(await answered, { t: 's', i: 'q-2', r: 'ok' });
    } finally {
      await run.done();
    }
  });

  it('writes the coverage an app sends to a file for Vitest, without what is past each source', async () => {
    const run = await setup();
    try {
      const phone = run.app('one');
      const { worker, messages } = run.worker();
      const starting = worker.start();
      void phone.poll().catch(() => {});
      await starting;
      const dep = join(run.root, 'src/dep.ts');
      const location = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 1 } });
      const coverage = {
        [dep]: {
          path: dep,
          statementMap: { 0: location(1), 1: location(40) },
          s: { 0: 1, 1: 5 },
          fnMap: { 0: { name: 'swap', loc: location(41) } },
          f: { 0: 2 },
          branchMap: {},
          b: {},
        },
      };
      void phone
        .post('/rpc', { call: { t: 'q', m: 'onAfterSuiteRun', a: [{ coverage }], i: 'c-1' } })
        .catch(() => {});
      await wait(50);
      const [call] = messages as { a: [{ coverage: string }] }[];
      const written = JSON.parse(readFileSync(call!.a[0].coverage, 'utf8'));
      assert.deepEqual(written[dep].s, { 0: 1 }, 'the statement past the last line is left out');
      assert.deepEqual(written[dep].f, {});
    } finally {
      await run.done();
    }
  });

  it('reads and writes snapshot files for the app, and nothing else', async () => {
    const run = await setup();
    try {
      run.worker();
      const phone = run.app('one');
      const snap = join(run.root, 'src/__snapshots__/a.device.ts.snap');
      await phone.post('/files', { op: 'write', path: snap, content: 'exports[`a`] = `1`;' });
      assert.deepEqual(await phone.post('/files', { op: 'read', path: snap }), {
        result: 'exports[`a`] = `1`;',
      });
      await phone.post('/files', { op: 'remove', path: snap });
      assert.equal(existsSync(snap), false);
      const refused = await phone.post('/files', { op: 'read', path: '/etc/passwd' });
      assert.match(refused.error, /Not a snapshot file/);
    } finally {
      await run.done();
    }
  });

  it('fails at once when its port is taken, rather than waiting on an app it cannot hear', async () => {
    const blocker = createServer();
    const port = await freePort();
    await new Promise<void>((resolve) => blocker.listen(port, '0.0.0.0', resolve));
    const run = await setup({ port });
    try {
      // After the failed listen, as for the next worker Vitest makes on the same port.
      await wait(50);
      await assert.rejects(run.worker().worker.start(), /cannot listen on port/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
      await run.done();
    }
  });
});

describe('withDeviceTests', () => {
  const resolveOf = (config: { resolver: { resolveRequest: Function } }, name: string) =>
    config.resolver.resolveRequest({ resolveRequest: () => ({ type: 'empty' }) }, name, 'ios');

  it('keeps the test host out of a bundle Metro was not started for device tests with', async () => {
    const { withDeviceTests } = await import('@ng-native/testing/device/metro');
    const before = process.env['EXPO_PUBLIC_DEVICE_TESTS'];
    delete process.env['EXPO_PUBLIC_DEVICE_TESTS'];
    try {
      const config = withDeviceTests({
        projectRoot: tmpdir(),
        resolver: {},
        transformer: {},
      }) as unknown as {
        resolver: { resolveRequest: Function };
        transformer: Record<string, unknown>;
      };
      assert.match(
        resolveOf(config, '@ng-native/testing/device/host').filePath,
        /host-disabled\.ts$/,
      );
      assert.deepEqual(resolveOf(config, 'vitest'), { type: 'empty' }, 'Vitest left alone');
      assert.equal(config.transformer.dynamicDepsInPackages, undefined);
    } finally {
      if (before === undefined) delete process.env['EXPO_PUBLIC_DEVICE_TESTS'];
      else process.env['EXPO_PUBLIC_DEVICE_TESTS'] = before;
    }
  });
});
