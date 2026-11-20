/**
 * `@ng-native/testing/device`: the Vitest pool whose workers are apps on devices, the reading of a
 * Metro bundle it sends them from, and the Metro config's two modes.
 *
 * An app is a stand-in here that speaks the test host's side of the protocol over HTTP, as the real
 * one does from a device, and Metro is a stand-in that serves one bundle.
 */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import Module, { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { PNG } from 'pngjs';
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
  const served: { bundle: string; hold?: Promise<void> } = {
    bundle: [
      define(10, [11, 12], 'src/a.device.ts'),
      define(11, [], 'src/dep.ts', 'exports.x = 1;'),
      define(12, [], 'node_modules/x/index.js'),
    ].join('\n'),
  };
  const metro: Server = createHttpServer((request, response) => {
    void Promise.resolve(served.hold).then(() => {
      if (request.url?.startsWith('/src/a.device.bundle')) response.end(served.bundle);
      else response.writeHead(404).end('{"message":"not found"}');
    });
  });
  await new Promise<void>((resolve) => metro.listen(0, '127.0.0.1', resolve));
  const metroPort = (metro.address() as { port: number }).port;

  const port = options.port ?? (await freePort());
  const pool = devicePool({ connectTimeout: 2000, metroPort, ...options, port, serverRoot: root });
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

/** A launcher whose apps a test ends by hand, as their processes would. */
function fakeLauncher(crashReport?: () => string | undefined | Promise<string | undefined>) {
  const launches: { exit: (how: string) => void; stopped: boolean }[] = [];
  const launch = {
    start: () => {
      let exit!: (how: string) => void;
      const exited = new Promise<string>((resolve) => (exit = resolve));
      const launched = { exit, stopped: false };
      launches.push(launched);
      return {
        exited,
        stop: async () => {
          launched.stopped = true;
        },
      };
    },
    ...(crashReport && { crashReport }),
  };
  return { launch, launches };
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

  it('fails no request a quiet app owes when a second device connects', async () => {
    // The same app on another simulator has the same platform and Metro: it is no relaunch.
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
      assert.deepEqual(messages, []);
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

  it('reads and writes snapshot files for the app it runs, and nothing else', async () => {
    const run = await setup();
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      await first;
      const snap = join(run.root, 'src/__snapshots__/a.device.ts.snap');
      await phone.post('/files', { op: 'write', path: snap, content: 'exports[`a`] = `1`;' });
      assert.deepEqual(await phone.post('/files', { op: 'read', path: snap }), {
        result: 'exports[`a`] = `1`;',
      });
      await phone.post('/files', { op: 'remove', path: snap });
      assert.equal(existsSync(snap), false);
      assert.deepEqual(
        await phone.post('/files', { op: 'read', path: test }),
        { result: "vi.mock('./dep.ts', () => ({}));\n" },
        'the test file it runs, which an inline snapshot is written into',
      );
      const refused = async (body: Record<string, unknown>, from = phone) =>
        assert.match((await from.post('/files', body)).error, /Not a snapshot file/);
      await refused({ op: 'read', path: '/etc/passwd' });
      await refused({ op: 'write', path: join(run.root, 'src/dep.ts'), content: '' });
      await refused({ op: 'write', path: join(tmpdir(), 'elsewhere.snap'), content: '' });
      await refused({ op: 'read', path: join(run.root, 'src/../../elsewhere.snap') });
      const linked = join(run.root, 'src/__linked__');
      symlinkSync(tmpdir(), linked);
      await refused({ op: 'write', path: join(linked, 'escape.snap'), content: '' });
      await refused({ op: 'read', path: snap }, run.app('stranger'));
    } finally {
      await run.done();
    }
  });

  it("compares screenshots for the app it runs, under the project's options, in the files it sent", async () => {
    const run = await setup({ screenshots: { comparatorOptions: { allowedMismatchedPixels: 1 } } });
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      await first;
      const shot = (changed: number[]) => {
        const image = new PNG({ width: 2, height: 2 });
        for (let i = 0; i < 4; i++)
          image.data.set([changed.includes(i) ? 255 : 0, 0, 0, 255], i * 4);
        return PNG.sync.write(image).toString('base64');
      };
      const compare = (png: string, from = phone, file = test) =>
        from.post('/screenshot', { file, name: 'card', png, update: 'new', platform: 'android' });
      const recorded = await compare(shot([]));
      assert.equal(recorded.result.pass, true);
      assert.equal(
        recorded.result.reference,
        join(run.root, 'src/__screenshots__/a.device.ts/card-ios.png'),
        "the app's own platform, whatever the request says",
      );
      assert.equal(existsSync(recorded.result.reference), true);
      assert.equal((await compare(shot([0]))).result.pass, true, 'the project allows one pixel');
      assert.equal((await compare(shot([0, 1]))).result.pass, false);
      assert.match(
        (await compare(shot([]), phone, join(run.root, 'src/dep.ts'))).error,
        /Not a test file/,
      );
      assert.match((await compare(shot([]), run.app('stranger'))).error, /Not a test file/);
    } finally {
      await run.done();
    }
  });

  it('answers a request it cannot read with a 400', async () => {
    const run = await setup();
    try {
      run.worker();
      const response = await Promise.race([
        fetch(`http://127.0.0.1:${run.port}/files`, { method: 'POST', body: '{' }),
        wait(1000).then(() => null),
      ]);
      assert.equal(response?.status, 400);
    } finally {
      await run.done();
    }
  });

  it('finds a mocked module that exists only as a platform file', async () => {
    const run = await setup();
    try {
      writeFileSync(join(run.root, 'src/a.device.ts'), "vi.mock('./dep', () => ({}));\n");
      rmSync(join(run.root, 'src/dep.ts'));
      writeFileSync(join(run.root, 'src/dep.ios.ts'), 'export const x = 1;\n');
      writeFileSync(join(run.root, 'src/dep.android.ts'), 'export const x = 2;\n');
      run.served.bundle = run.served.bundle.replace('"src/dep.ts"', '"src/dep.ios.ts"');
      const phone = run.app('one');
      const { worker } = run.worker();
      const starting = worker.start();
      const first = phone.poll();
      await starting;
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      assert.deepEqual((await first).files[test].mocks, { './dep': 11 });
    } finally {
      await run.done();
    }
  });

  it('takes a reply only for the request it answers, and only once', async () => {
    const run = await setup();
    try {
      const { worker, messages } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      worker.send(request('start') as never);
      const asked = await first;
      const reply = {
        __vitest_worker_response__: true,
        type: 'started',
        deviceRequest: asked.deviceRequest,
      };
      const second = phone.poll({ reply });
      await wait(20);
      worker.send(request('cancel') as never);
      await second;
      // The same reply again, as the app sends it when a poll fails on the way back.
      void phone.poll({ reply }).catch(() => {});
      await wait(50);
      assert.deepEqual(
        (messages as { type?: string }[]).map((message) => message.type),
        ['started'],
        'the repeat answers nothing',
      );
    } finally {
      await run.done();
    }
  });

  it('still fails a request the app owes after it repeats an earlier reply, then goes quiet', async () => {
    const run = await setup({ appTimeout: 300 });
    try {
      const { worker, messages } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      worker.send(request('start') as never);
      const asked = await first;
      const reply = {
        __vitest_worker_response__: true,
        type: 'started',
        deviceRequest: asked.deviceRequest,
      };
      const second = phone.poll({ reply });
      await wait(20);
      worker.send(request('cancel') as never);
      await second;
      // The repeat comes while the cancel is still owed, and then the app is heard from no more.
      void phone.poll({ reply }).catch(() => {});
      await wait(700);
      const failed = (messages as { error?: Error }[]).find((message) => message.error);
      assert.match(String(failed?.error?.message), /stopped answering/);
    } finally {
      await run.done();
    }
  });

  it('refuses a snapshot path that resolves to a file it may not touch, or nowhere', async () => {
    const run = await setup();
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      worker.send(
        request('run', { files: [{ filepath: join(run.root, 'src/a.device.ts') }] }) as never,
      );
      await first;
      const refused = async (body: Record<string, unknown>) =>
        assert.match((await phone.post('/files', body)).error, /Not a snapshot file/);
      // A .snap name for a source file.
      symlinkSync(join(run.root, 'src/dep.ts'), join(run.root, 'src/alias.snap'));
      await refused({ op: 'write', path: join(run.root, 'src/alias.snap'), content: '' });
      assert.equal(readFileSync(join(run.root, 'src/dep.ts'), 'utf8'), 'export const x = 1;\n');
      // A way into the project's packages.
      mkdirSync(join(run.root, 'node_modules/pkg'), { recursive: true });
      symlinkSync(join(run.root, 'node_modules'), join(run.root, 'src/packages'));
      await refused({ op: 'write', path: join(run.root, 'src/packages/pkg/a.snap'), content: '' });
      assert.equal(existsSync(join(run.root, 'node_modules/pkg/a.snap')), false);
      // A link to a file outside the project that does not exist yet.
      const outside = join(tmpdir(), `device-pool-escape-${process.pid}.snap`);
      symlinkSync(outside, join(run.root, 'src/escape.snap'));
      try {
        await refused({ op: 'write', path: join(run.root, 'src/escape.snap'), content: '' });
        assert.equal(existsSync(outside), false);
      } finally {
        rmSync(outside, { force: true });
      }
    } finally {
      await run.done();
    }
  });

  it('touches the normalised snapshot path, not a link followed before a dot-dot', async () => {
    const run = await setup();
    const outside = mkdtempSync(join(tmpdir(), 'device-pool-dotdot-'));
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      const phone = run.app('one');
      const first = phone.poll();
      await starting;
      worker.send(
        request('run', { files: [{ filepath: join(run.root, 'src/a.device.ts') }] }) as never,
      );
      await first;
      mkdirSync(join(outside, 'sub'));
      symlinkSync(join(outside, 'sub'), join(run.root, 'src/link'));
      // The kernel follows `link` before `..`, so the raw string names a file beside `sub`.
      const raw = `${join(run.root, 'src/link')}/../victim.snap`;
      await phone.post('/files', { op: 'write', path: raw, content: 'x' });
      assert.equal(existsSync(join(outside, 'victim.snap')), false);
      assert.equal(readFileSync(join(run.root, 'src/victim.snap'), 'utf8'), 'x');
    } finally {
      rmSync(outside, { recursive: true, force: true });
      await run.done();
    }
  });

  it('maps a mock to the file Metro resolves, trying each extension in turn', async () => {
    const run = await setup();
    try {
      writeFileSync(join(run.root, 'src/a.device.ts'), "vi.mock('./dep', () => ({}));\n");
      writeFileSync(join(run.root, 'src/dep.ios.js'), 'exports.x = 2;\n');
      // Metro takes dep.ts for './dep', as .ts comes before .js; dep.ios.js is in the bundle too.
      run.served.bundle += `\n${define(13, [], 'src/dep.ios.js')}`;
      const phone = run.app('one');
      const { worker } = run.worker();
      const starting = worker.start();
      const first = phone.poll();
      await starting;
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      assert.deepEqual((await first).files[test].mocks, { './dep': 11 });
    } finally {
      await run.done();
    }
  });

  it('keeps an idle app on another device when a second one connects', async () => {
    const run = await setup();
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      const one = run.app('one');
      void one.poll().catch(() => {});
      await starting;
      // The same app on a second simulator: the same platform and the same Metro.
      void run
        .app('two')
        .poll()
        .catch(() => {});
      await wait(20);
      const next = one.poll();
      await wait(20);
      worker.send(request('cancel') as never);
      const asked = await Promise.race([next, wait(1000).then(() => ({ type: 'nothing' }))]);
      assert.equal(asked?.type, 'cancel', 'the worker still has the first app');
    } finally {
      await run.done();
    }
  });

  it('lets go of its claim when the app it launched exits before it connects', async () => {
    const { launch, launches } = fakeLauncher();
    const run = await setup({ launch });
    try {
      const first = run.worker().worker.start();
      await wait(20);
      launches[0]!.exit('status 1');
      await assert.rejects(first, /exited before it connected/);
      void run
        .app('one')
        .poll()
        .catch(() => {});
      await wait(50);
      await run.worker().worker.start();
      assert.equal(launches.length, 1, 'the next worker found the app free, and launched none');
    } finally {
      await run.done();
    }
  });

  it('hands no other worker the app it launched as it stops', async () => {
    const { launch } = fakeLauncher();
    const run = await setup({ launch });
    try {
      const a = run.worker();
      const startingA = a.worker.start();
      void run
        .app('one')
        .poll()
        .catch(() => {});
      await startingA;
      const b = run.worker();
      const startingB = b.worker.start();
      await wait(20);
      await a.worker.stop();
      const two = run.app('two').poll();
      await startingB;
      b.worker.send(request('cancel') as never);
      const asked = await Promise.race([two, wait(1000).then(() => ({ type: 'nothing' }))]);
      assert.equal(asked?.type, 'cancel', 'the app B launched, not the one A was stopping');
    } finally {
      await run.done();
    }
  });

  it('says the app it launched did not connect, not to open one by hand', async () => {
    const { launch } = fakeLauncher();
    const run = await setup({ launch, connectTimeout: 100 });
    try {
      await assert.rejects(run.worker().worker.start(), /app the pool launched did not connect/);
    } finally {
      await run.done();
    }
  });

  it('answers start itself while the app it launches has yet to connect, and only once', async () => {
    const { launch } = fakeLauncher();
    const run = await setup({ launch });
    try {
      const { worker, messages } = run.worker();
      const starting = worker.start();
      worker.send(request('start', { config: { root: run.root } }) as never);
      await wait(20);
      assert.deepEqual(
        messages.map((message) => (message as { type?: string }).type),
        ['started'],
        'before any app has connected',
      );
      const phone = run.app('one');
      const asked = await phone.poll();
      await starting;
      assert.equal(asked?.type, 'start', 'the app still gets the request, with its config');
      void phone
        .poll({
          reply: {
            __vitest_worker_response__: true,
            type: 'started',
            deviceRequest: asked.deviceRequest,
          },
        })
        .catch(() => {});
      await wait(50);
      assert.equal(
        messages.filter((message) => (message as { type?: string }).type === 'started').length,
        1,
      );
    } finally {
      await run.done();
    }
  });

  it('launches no app after it stops while replacing one that exited', async () => {
    const { launch, launches } = fakeLauncher();
    let release!: () => void;
    const slowStop = new Promise<void>((resolve) => (release = resolve));
    const start = launch.start;
    launch.start = () => {
      const app = start();
      return { ...app, stop: () => app.stop().then(() => slowStop) };
    };
    const run = await setup({ launch });
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      void run
        .app('one')
        .poll()
        .catch(() => {});
      await starting;
      // The app exits with nothing owed: the worker stops it, slowly, to replace it.
      launches[0]!.exit('status 0');
      await wait(20);
      const stopping = worker.stop();
      release();
      await stopping;
      await wait(50);
      assert.equal(launches.length, 1, 'no replacement after the stop');
    } finally {
      await run.done();
    }
  });

  it('sends a file to the app that replaced one that exited while Metro bundled it', async () => {
    const { launch, launches } = fakeLauncher();
    const run = await setup({ launch });
    try {
      const { worker } = run.worker();
      const starting = worker.start();
      void run
        .app('one')
        .poll()
        .catch(() => {});
      await starting;
      let release!: () => void;
      run.served.hold = new Promise<void>((resolve) => (release = resolve));
      const test = join(run.root, 'src/a.device.ts');
      worker.send(request('run', { files: [{ filepath: test }] }) as never);
      await wait(20);
      launches[0]!.exit('status 0');
      await wait(20);
      const two = run.app('two').poll();
      await wait(20);
      release();
      const asked = await Promise.race([two, wait(1000).then(() => ({ type: 'nothing' }))]);
      assert.equal(asked?.type, 'run');
    } finally {
      await run.done();
    }
  });

  for (const [how, crashReport] of [
    ['rejects', () => Promise.reject(new Error('no reports'))],
    [
      'throws',
      () => {
        throw new Error('no reports');
      },
    ],
  ] as const) {
    it(`fails the file a lost app was running when reading its crash report ${how}`, async () => {
      const { launch, launches } = fakeLauncher(crashReport);
      const run = await setup({ launch });
      try {
        const { worker, messages } = run.worker();
        const starting = worker.start();
        const first = run.app('one').poll();
        await starting;
        worker.send(request('cancel') as never);
        await first;
        launches[0]!.exit('signal SIGKILL');
        await wait(50);
        const [failed] = messages as { error?: Error }[];
        assert.match(String(failed?.error?.message), /The app exited \(signal SIGKILL\)/);
      } finally {
        await run.done();
      }
    });
  }

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
  const require = createRequire(import.meta.url);
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
      const stub = resolveOf(config, '@ng-native/testing/device/host').filePath as string;
      assert.match(stub, /host-disabled\.c?[jt]s$/);
      assert.ok(existsSync(stub), stub);
      // The published package holds only what its manifest lists: a stub outside it is a missing
      // file in every app that installs the package.
      const root = dirname(require.resolve('@ng-native/testing/package.json'));
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        files: string[];
      };
      const relative = stub.slice(root.length + 1);
      assert.ok(
        manifest.files.some((entry) => relative.startsWith(`${entry}/`)),
        `${relative} is in the published files`,
      );
      assert.deepEqual(resolveOf(config, 'vitest'), { type: 'empty' }, 'Vitest left alone');
      assert.equal(config.transformer.dynamicDepsInPackages, undefined);
    } finally {
      if (before === undefined) delete process.env['EXPO_PUBLIC_DEVICE_TESTS'];
      else process.env['EXPO_PUBLIC_DEVICE_TESTS'] = before;
    }
  });

  for (const [vitest, instrumenter] of [
    ['4.0.8', 'istanbul-lib-instrument'],
    ['5.1.0', '@vitest/istanbul-lib-instrument'],
  ] as const) {
    it(`instruments with the package Vitest ${vitest}'s istanbul provider uses`, () => {
      // Vitest 4's provider depends on istanbul-lib-instrument, Vitest 5's on the scoped fork.
      const project = mkdtempSync(join(tmpdir(), 'ng-native-coverage-'));
      const before = process.env['NG_NATIVE_DEVICE_TESTS_TRANSFORMER'];
      const scope = globalThis as { __instrumented?: string[] };
      try {
        const provider = join(project, 'node_modules/@vitest/coverage-istanbul');
        const own = join(provider, 'node_modules', instrumenter);
        mkdirSync(own, { recursive: true });
        writeFileSync(
          join(provider, 'package.json'),
          JSON.stringify({
            name: '@vitest/coverage-istanbul',
            version: vitest,
            dependencies: { [instrumenter]: '*' },
          }),
        );
        writeFileSync(join(own, 'package.json'), JSON.stringify({ name: instrumenter }));
        writeFileSync(
          join(own, 'index.js'),
          'exports.programVisitor = (_t, file) => ({ enter() { (globalThis.__instrumented ??= []).push(file); }, exit() {} });',
        );
        mkdirSync(join(project, 'node_modules/@babel'), { recursive: true });
        symlinkSync(
          dirname(createRequire(import.meta.url).resolve('@babel/core/package.json')),
          join(project, 'node_modules/@babel/core'),
        );
        const upstream = join(project, 'upstream.cjs');
        writeFileSync(
          upstream,
          'module.exports = { transform: ({ src }) => ({ ast: require("@babel/core").parseSync(src, { sourceType: "module" }) }) };',
        );
        process.env['NG_NATIVE_DEVICE_TESTS_TRANSFORMER'] = upstream;
        const load = createRequire(import.meta.url);
        const path = load.resolve('@ng-native/testing/device/transformer');
        delete load.cache[path];
        const transformer = load(path) as { transform(params: object): unknown };
        transformer.transform({
          filename: 'src/a.ts',
          src: 'export const a = 1;',
          options: { projectRoot: project },
        });
        assert.deepEqual(scope.__instrumented, [join(project, 'src/a.ts')]);
      } finally {
        delete scope.__instrumented;
        if (before === undefined) delete process.env['NG_NATIVE_DEVICE_TESTS_TRANSFORMER'];
        else process.env['NG_NATIVE_DEVICE_TESTS_TRANSFORMER'] = before;
        rmSync(project, { recursive: true, force: true });
      }
    });
  }

  it('leaves esbuild out of what an app installs with @ng-native/testing', () => {
    // pnpm stops an app's install on a dependency's build script it was not told to allow, and
    // esbuild has one: an app that never runs a test in the app would have to decide about it.
    const manifest = JSON.parse(
      readFileSync(require.resolve('@ng-native/testing/package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.equal(manifest[field]?.['esbuild'], undefined, `esbuild in ${field}`);
    }
  });

  it("bundles the project's Vitest for a device with the bundler its Vite brings", async () => {
    const { withDeviceTests } = await import('@ng-native/testing/device/metro');
    const testing = dirname(require.resolve('@ng-native/testing/package.json'));
    const vitest = dirname(
      realpathSync(require.resolve('vitest/package.json', { paths: [testing] })),
    );
    const project = mkdtempSync(join(tmpdir(), 'device-tests-runtime-'));
    mkdirSync(join(project, 'node_modules'));
    symlinkSync(vitest, join(project, 'node_modules/vitest'), 'dir');
    const modules = Module as unknown as { _resolveFilename: Function };
    const resolveFilename = modules._resolveFilename;
    // An app that does not list esbuild has none to find.
    modules._resolveFilename = function (request: string, ...rest: unknown[]) {
      if (request === 'esbuild') throw new Error('esbuild is not installed');
      return resolveFilename.call(this, request, ...rest);
    };
    const before = process.env['EXPO_PUBLIC_DEVICE_TESTS'];
    process.env['EXPO_PUBLIC_DEVICE_TESTS'] = '1';
    try {
      const config = withDeviceTests({
        projectRoot: project,
        resolver: {},
        transformer: {},
      }) as unknown as { resolver: { resolveRequest: Function } };
      const runtime = resolveOf(config, 'vitest').filePath as string;
      assert.ok(runtime.startsWith(join(project, 'node_modules/.cache')), runtime);
      const source = readFileSync(runtime, 'utf8');
      // Metro refuses an import() with a computed path.
      assert.doesNotMatch(source, /(^|[^.\w$])import\(/m);
      const exports = createRequire(import.meta.url)(runtime) as Record<string, unknown>;
      for (const name of ['describe', 'it', 'expect', 'startTests', 'silenceRegistration']) {
        assert.equal(typeof exports[name], 'function', name);
      }
    } finally {
      modules._resolveFilename = resolveFilename;
      if (before === undefined) delete process.env['EXPO_PUBLIC_DEVICE_TESTS'];
      else process.env['EXPO_PUBLIC_DEVICE_TESTS'] = before;
      rmSync(project, { recursive: true, force: true });
    }
  });
});
