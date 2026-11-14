/**
 * Running test files in the app: Vitest's own `TestRunner`, which a Vitest worker runs, with each
 * file loaded from what the pool sent and its calls to Vitest made over HTTP. What the test runner
 * brings with it comes along: snapshots, `expect.assertions`, fixtures, `onTestFailed`.
 */
// First: Vitest reads its worker state as it loads.
import './worker-state.ts';
import * as vitest from 'vitest';
import type * as browserRunner from 'vitest/internal/browser';
import { cleanup } from './index.ts';
import { define, isolate, rerun } from './loader.ts';
import { installMocking, prepareMocks, restoreMocks } from './mock-registry.ts';
import type { FilePayload } from './pool.ts';
import {
  DeviceSnapshotEnvironment,
  inferInlineSnapshotFrames,
  placeInlineSnapshots,
} from './snapshots.ts';
import { symbolicateStack } from './symbolicate.ts';

interface Runtime {
  startTests: typeof browserRunner.startTests;
  collectTests: typeof browserRunner.collectTests;
  setupCommonEnv?: (config: unknown) => Promise<void>;
  silenceRegistration: (silent: boolean) => void;
  TestRunner: new (config: unknown) => TestRunnerLike;
  vi: Parameters<typeof installMocking>[0];
}

interface TestRunnerLike {
  config: Record<string, unknown>;
  snapshotClient: { getSnapshotState(filepath: string): unknown };
  onCollectStart?(file: unknown): unknown;
  onBeforeRunTask?(test: unknown): unknown;
  onAfterRunTask?(test: unknown): unknown;
  onAfterRunSuite?(suite: unknown): Promise<void>;
  onBeforeRunSuite?(suite: unknown): Promise<void>;
  onAfterRunFiles?(files: unknown): unknown;
  __setTraces?(traces: unknown): void;
}

// `vitest` in a device test bundle is the runtime `withDeviceTests()` builds, which carries the
// runner as well as `describe`, `it` and `expect`.
const runtime = vitest as unknown as Runtime;

/** A request to run (or only collect) test files, as the pool sends it. */
export interface RunRequest {
  type: 'run' | 'collect';
  context?: { files?: { filepath: string }[]; providedContext?: unknown };
  files?: Record<string, FilePayload>;
}

const HEARTBEAT_MS = 1000;

/** No tracing: the test runner wraps its steps in spans, which a device run does not record. */
const traces = {
  $: (_name: string, options: unknown, run?: () => unknown) =>
    typeof options === 'function' ? (options as () => unknown)() : run!(),
};

export async function runFiles(
  url: string,
  session: string,
  request: RunRequest,
  config: Record<string, unknown>,
): Promise<void> {
  const rpc = createRpc(url, session);
  const files = (method: 'read' | 'write' | 'remove', path: string, content?: string) =>
    post(url, '/files', { session, op: method, path, content }).then((answer) => {
      const { result, error } = answer as { result?: unknown; error?: string };
      if (error) throw new Error(error);
      return result;
    });
  const payloads = request.files ?? {};
  let current: string | undefined;

  setWorkerState(config, request, rpc);
  config['snapshotOptions'] = {
    ...(config['snapshotOptions'] as object),
    snapshotEnvironment: new DeviceSnapshotEnvironment(rpc, files),
  };
  await runtime.setupCommonEnv?.(config);
  installMocking(runtime.vi);

  const projectModule = (name: string) => !name.startsWith('../') && !name.includes('node_modules');

  class DeviceRunner extends runtime.TestRunner {
    async importFile(filepath: string): Promise<void> {
      const payload = payloads[filepath];
      if (!payload) throw new Error(`The pool sent nothing to run ${filepath}`);
      // What the file before mocked is put back first, whatever happened at its end.
      restoreMocks();
      // Vitest makes a worker per file when it isolates them: each starts afresh, the first too,
      // since the app has run earlier files and earlier runs.
      if (config['isolate']) isolate(projectModule);
      define(payload);
      await prepareMocks(payload.mocks, payload.entry, () => {
        runtime.silenceRegistration(true);
        try {
          rerun(payload.entry);
        } finally {
          runtime.silenceRegistration(false);
        }
      });
      rerun(payload.entry);
    }

    override async onCollectStart(file: unknown): Promise<void> {
      await rpc('onQueued', file);
      await super.onCollectStart?.(file);
    }

    async onCollected(collected: unknown[]): Promise<void> {
      await rpc('onCollected', collected);
    }

    async onTaskUpdate(packs: TaskPack[], events: unknown[]): Promise<void> {
      // Copied before anything is awaited: the runner clears these arrays once this returns.
      const sent = [...events];
      await rpc('onTaskUpdate', await symbolicatePacks([...packs]), sent);
    }

    override async onBeforeRunSuite(suite: unknown): Promise<void> {
      await super.onBeforeRunSuite?.(suite);
      const file = suite as { filepath?: string };
      if (file.filepath) {
        inferInlineSnapshotFrames(
          this.snapshotClient.getSnapshotState(file.filepath),
          file.filepath,
        );
      }
    }

    override onBeforeRunTask(test: unknown): unknown {
      current = (test as { id: string }).id;
      return super.onBeforeRunTask?.(test);
    }

    override async onAfterRunTask(test: unknown): Promise<void> {
      await super.onAfterRunTask?.(test);
      current = undefined;
      cleanup();
    }

    override async onAfterRunSuite(suite: unknown): Promise<void> {
      const file = suite as { filepath?: string; file?: { filepath: string } };
      if (file.filepath) {
        await placeInlineSnapshots(
          this.snapshotClient.getSnapshotState(file.filepath),
          payloads[file.filepath]?.url ?? '',
        );
      }
      try {
        await super.onAfterRunSuite?.(suite);
      } finally {
        if (file.filepath) restoreMocks();
      }
    }
  }

  resetCoverage();
  // A run starts with the app's own modules afresh, as a Vitest run in Node starts in a new
  // process: nothing a test left in module state carries over to the next run.
  isolate(projectModule);
  const runner = new DeviceRunner(config);
  runner.__setTraces?.(traces);
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const previous = utils?.getGlobalHandler();
  utils?.setGlobalHandler((error) => void rpc('onUnhandledError', serializeError(error), 'Error'));
  // A test's console output goes to Vitest, under the test, as it does in Node; Metro still has it.
  const restore = forwardConsole(
    (type, content) =>
      current !== undefined &&
      void rpc('onUserConsoleLog', {
        type,
        content,
        taskId: current,
        time: Date.now(),
        size: content.length,
      }),
  );
  // Proof of life while the run goes on, which tells the pool from an app that has gone.
  const alive = setInterval(
    () => void post(url, '/alive', { session }).catch(() => {}),
    HEARTBEAT_MS,
  );
  try {
    const run = request.type === 'collect' ? runtime.collectTests : runtime.startTests;
    await run((request.context?.files ?? []) as never, runner as never);
    await reportCoverage(config, request, rpc);
  } finally {
    clearInterval(alive);
    restore();
    restoreMocks();
    if (previous) utils?.setGlobalHandler(previous);
  }
}

type Rpc = (method: string, ...args: unknown[]) => Promise<unknown>;

/**
 * The runner's calls to Vitest, one at a time and each answered before the next, as a Vitest
 * worker's are: Vitest has to have the collected tests before it hears how they went.
 */
function createRpc(url: string, session: string): Rpc {
  let queue: Promise<unknown> = Promise.resolve();
  let id = 0;
  return (method, ...args) => {
    const next = queue.then(async () => {
      const call = { t: 'q', m: method, a: args, i: `${session}-${++id}` };
      const answer = (await post(url, '/rpc', { session, call })) as { r?: unknown; e?: unknown };
      // Vitest's error, as the pool sent it: its fields, which an Error is rebuilt from.
      if (answer.e) throw Object.assign(new Error(), answer.e);
      return answer.r;
    });
    queue = next.catch(() => {});
    return next;
  };
}

async function post(url: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, { method: 'POST', body: serialize(body) });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** What Vitest's own worker sets up, which the test runner and `vi` read. */
function setWorkerState(config: Record<string, unknown>, request: RunRequest, rpc: Rpc): void {
  (globalThis as { __vitest_worker__?: unknown }).__vitest_worker__ = {
    config,
    ctx: { workerId: 1, concurrencyId: 1, pool: 'device', ...request.context },
    environment: { name: 'node' },
    providedContext: request.context?.providedContext ?? {},
    durations: { environment: 0, prepare: 0 },
    onCleanup: () => {},
    rpc: new Proxy(
      {},
      {
        get:
          (_, method: string) =>
          (...args: unknown[]) =>
            rpc(method, ...args),
      },
    ),
  };
}

/**
 * Coverage, when Metro instrumented the app's code (`withDeviceTests` does when Vitest asks for
 * coverage): what the run counted, for Vitest's istanbul provider to merge.
 */
async function reportCoverage(
  config: Record<string, unknown>,
  request: RunRequest,
  rpc: Rpc,
): Promise<void> {
  const coverage = (globalThis as { __coverage__?: unknown }).__coverage__;
  const enabled = (config['coverage'] as { enabled?: boolean } | undefined)?.enabled;
  if (!enabled || !coverage || request.type !== 'run') return;
  await rpc('onAfterSuiteRun', {
    // The pool writes it to the file Vitest's provider reads it from.
    coverage,
    testFiles: (request.context?.files ?? []).map(({ filepath }) => filepath),
    environment: 'node',
    projectName: (config['name'] as string | undefined) ?? '',
  });
}

/** Counts from zero for each run: the app's counters carry on across runs otherwise. */
function resetCoverage(): void {
  const coverage = (globalThis as { __coverage__?: Record<string, FileCoverage> }).__coverage__;
  for (const file of Object.values(coverage ?? {})) {
    for (const key of Object.keys(file.s)) file.s[key] = 0;
    for (const key of Object.keys(file.f)) file.f[key] = 0;
    for (const key of Object.keys(file.b)) file.b[key] = file.b[key]!.map(() => 0);
  }
}

interface FileCoverage {
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
}

type TaskPack = [string, { errors?: { stack?: string }[] } | undefined, unknown];

/** Error stacks as source positions, by Metro's own symbolication, which the app's are not. */
async function symbolicatePacks(packs: TaskPack[]): Promise<TaskPack[]> {
  for (const [, result] of packs) {
    for (const error of result?.errors ?? []) {
      if (error.stack) error.stack = await symbolicateStack(error.stack);
    }
  }
  return packs;
}

const LEVELS = ['log', 'info', 'debug', 'warn', 'error'] as const;

function forwardConsole(send: (type: 'stdout' | 'stderr', content: string) => void): () => void {
  const originals = LEVELS.map((level) => console[level]);
  LEVELS.forEach((level, i) => {
    console[level] = (...values: unknown[]) => {
      const text = values.map((value) => (typeof value === 'string' ? value : stringify(value)));
      send(level === 'warn' || level === 'error' ? 'stderr' : 'stdout', `${text.join(' ')}\n`);
      originals[i]!.apply(console, values);
    };
  });
  return () => LEVELS.forEach((level, i) => (console[level] = originals[i]!));
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type ErrorUtilsLike = {
  getGlobalHandler(): (error: unknown, fatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, fatal?: boolean) => void): void;
};

/**
 * JSON, without the links back up a task tree (`file`, `suite`) and a test's `context`, which
 * make it circular, nor the snapshot environment the config carries. The pool puts the links back.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value, (key, field: unknown) =>
    key === 'file' || key === 'suite' || key === 'context' || key === 'snapshotEnvironment'
      ? undefined
      : field,
  );
}

export function serializeError(error: unknown): { message: string; stack?: string; name?: string } {
  return error instanceof Error
    ? { message: error.message, stack: error.stack, name: error.name }
    : { message: String(error) };
}
