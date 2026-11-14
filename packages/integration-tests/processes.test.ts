/**
 * `Processes`, which on a desktop OS holds the app's environment, and will run programs the app
 * declares. On mobile and the web it is absent: `env` is empty and `available()` is false.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  Processes,
  UndeclaredCapabilityError,
  type NativeProcesses,
  type ProcessEvent,
} from '@ng-native/device';
import { cleanup, injectService } from '@ng-native/testing';

afterEach(cleanup);

describe('Processes', () => {
  it("holds the environment the desktop host's module reports", () => {
    const processes = injectService(Processes, {
      providers: [{ provide: Processes.SOURCE, useValue: { env: { HOME: '/Users/me' } } }],
    });
    assert.equal(processes.available(), true);
    assert.deepEqual(processes.env, { HOME: '/Users/me' });
    assert.ok(Object.isFrozen(processes.env), 'a copy the app cannot change under the host');
  });

  it("reads the environment from the desktop host's NgNativeProcesses module", () => {
    const host = globalThis as Record<string, unknown>;
    host['nativeFabricUIManager'] = {};
    host['require'] = (id: string) => {
      assert.equal(id, 'react-native');
      return {
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeProcesses'
              ? { getConstants: () => ({ env: { LANG: 'en_GB' } }) }
              : null,
        },
      };
    };
    try {
      const provider = (Processes.SOURCE as unknown as { ɵprov: { factory(): unknown } }).ɵprov;
      const source = provider.factory() as { env: object; envNames: string[] };
      assert.deepEqual(source.env, { LANG: 'en_GB' });
      assert.deepEqual(source.envNames, ['LANG'], 'what a spawned program may be given');
    } finally {
      delete host['nativeFabricUIManager'];
      delete host['require'];
    }
  });

  it('is absent without the module, with an empty environment', () => {
    const processes = injectService(Processes);
    assert.equal(processes.available(), false);
    assert.deepEqual(processes.env, {});
  });
});

/** A desktop host that records what it is asked to run, and lets a test play the program. */
function fakeHost(declared: Partial<NativeProcesses> = {}) {
  const spawned: { program: string; args: readonly string[]; cwd: string | null; env: object }[] =
    [];
  const sent: string[] = [];
  let listener: (event: ProcessEvent) => void = () => {};
  const host: NativeProcesses = {
    env: { HOME: '/Users/me', LANG: 'en_GB' },
    envNames: ['HOME', 'LANG', 'GIT_DIR'],
    spawnCapabilities: [
      { program: 'git', args: ['status', '--porcelain'] },
      { program: '/usr/bin/tool', args: ['{files:[\\w.]+}...'] },
    ],
    resolved: { git: '/opt/homebrew/bin/git' },
    spawn: async (program, args, cwd, env) => {
      spawned.push({ program, args, cwd, env });
      return spawned.length;
    },
    write: (handle, data) => void sent.push(`${handle}:write:${data}`),
    closeStdin: (handle) => void sent.push(`${handle}:end`),
    kill: (handle, signal) => void sent.push(`${handle}:kill:${signal}`),
    subscribe: (heard) => {
      listener = heard;
      return () => {};
    },
    ...declared,
  };
  return { host, spawned, sent, emit: (event: ProcessEvent) => listener(event) };
}

describe('Processes.spawn', () => {
  it('runs a declared program at the path it was pinned to, with its output and exit', async () => {
    const { host, spawned, sent, emit } = fakeHost();
    const processes = injectService(Processes, {
      providers: [{ provide: Processes.SOURCE, useValue: host }],
    });
    const git = await processes.spawn('git', ['status', '--porcelain'], { cwd: '/repo' });
    assert.ok(git);
    assert.deepEqual(spawned, [
      {
        program: '/opt/homebrew/bin/git',
        args: ['status', '--porcelain'],
        cwd: '/repo',
        env: { HOME: '/Users/me', LANG: 'en_GB' },
      },
    ]);
    const out: string[] = [];
    const err: string[] = [];
    git.onStdout((chunk) => out.push(chunk));
    git.onStderr((chunk) => err.push(chunk));
    emit({ type: 'stdout', handle: 1, data: ' M a.ts\n' });
    emit({ type: 'stderr', handle: 1, data: 'warning' });
    emit({ type: 'stdout', handle: 2, data: 'another program' });
    git.write('y');
    git.end();
    git.kill();
    emit({ type: 'exit', handle: 1, code: 0, signal: null });
    assert.deepEqual(await git.exit, { code: 0, signal: null });
    assert.deepEqual(out, [' M a.ts\n']);
    assert.deepEqual(err, ['warning']);
    assert.deepEqual(sent, ['1:write:y', '1:end', '1:kill:SIGTERM']);
  });

  it('throws for a call the app did not declare, and runs nothing', async () => {
    const { host, spawned } = fakeHost();
    const processes = injectService(Processes, {
      providers: [{ provide: Processes.SOURCE, useValue: host }],
    });
    await assert.rejects(processes.spawn('git', ['push']), UndeclaredCapabilityError);
    await assert.rejects(processes.spawn('/bin/sh', ['-c', 'git status']), /capabilities.spawn/);
    await assert.rejects(processes.spawn('/usr/bin/tool', ['a', '--exec=x']));
    assert.deepEqual(spawned, []);
  });

  it('passes only the declared environment variables', async () => {
    const { host, spawned } = fakeHost();
    const processes = injectService(Processes, {
      providers: [{ provide: Processes.SOURCE, useValue: host }],
    });
    await processes.spawn('/usr/bin/tool', ['a.txt'], {
      env: { GIT_DIR: '/repo/.git', DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' },
    });
    assert.deepEqual(spawned[0]!.env, { GIT_DIR: '/repo/.git' });
  });

  it('is inert where processes are absent: it resolves null', async () => {
    assert.equal(await injectService(Processes).spawn('git', ['status']), null);
  });
});
