/**
 * The Vitest pool that runs test files in apps on simulators and emulators.
 *
 *     // vitest.device.config.mts
 *     export default defineConfig({ plugins: [deviceTests()] });
 *
 * Vitest hands a pool's worker its requests (`start`, `run`, `stop`); here a worker is an app's
 * device test host, which long-polls this process over HTTP. Each app that polls is a session, and
 * each worker Vitest makes claims one, so with several devices open and `maxWorkers` above one,
 * files run on them side by side.
 *
 * For each file the pool fetches the test's bundle from Metro and sends the app only the modules it
 * does not have, or has in an older version: the app reports what it has, and a hash of each module
 * this pool or an earlier one sent it, so an edit anywhere a test reaches is picked up.
 */
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PoolOptions, PoolRunnerInitializer, PoolWorker } from 'vitest/node';
import { modulesOf, type BundleModule } from './bundle-modules.ts';
import { mockedSpecifiers } from './mocks.ts';
import { DEFAULT_PORT } from './port.ts';
import { type AppLauncher, type LaunchedApp } from './launcher.ts';

export type { AppLauncher, LaunchedApp, LaunchRequest } from './launcher.ts';

export interface DevicePoolOptions {
  /** The port the apps' test hosts poll. Default 51730. */
  port?: number;
  /**
   * Run only on apps on this platform: a project per platform runs every file on each. Default:
   * any app.
   */
  platform?: 'ios' | 'android' | 'macos';
  /**
   * Starts the app for each worker that finds none connected, and again after the app is lost: a
   * dropped session fails the file that was running, relaunches the app with fresh state, and the
   * run goes on with the files that remain. See `AppLauncher`, and `macosLauncher()` for a Mac.
   * Without one the app is opened by hand, as on a simulator, and a lost app ends the run.
   */
  launch?: AppLauncher;
  /**
   * The directory Metro serves files from. Default: the workspace root above the project, as
   * Expo's Metro config chooses it, or the project itself.
   */
  serverRoot?: string;
  /** How long to wait for an app to connect, in milliseconds. Default 60 seconds. */
  connectTimeout?: number;
  /**
   * How long an app may go silent while it owes Vitest an answer before the run fails as if the
   * app had closed, in milliseconds. Default 15 seconds; a test that blocks JavaScript for longer
   * needs more.
   */
  appTimeout?: number;
}

export function devicePool(options: DevicePoolOptions = {}): PoolRunnerInitializer {
  return {
    name: 'device',
    createPoolWorker: (pool) => new DeviceWorker(pool, options),
  };
}

/** One module of a test's bundle, as the app is sent it. */
export interface SentModule {
  id: number;
  code: string;
  hash: string;
  /** Its line in the bundle, which the app keeps it on. */
  line: number;
}

/** What the app needs to run one test file. */
export interface FilePayload {
  /** The test file's own module. */
  entry: number;
  /** Modules to define: those the app does not have, and those whose code changed. */
  modules: SentModule[];
  /** The modules among those the app has an older version of. */
  changed: number[];
  /** Each specifier the file passes `vi.mock` and its kin, as the module id it resolves to. */
  mocks: Record<string, number>;
  /** The URL the bundle came from, for the app's stack traces. */
  url: string;
  /** Why the file could not be bundled, when it could not. */
  error?: string;
}

class DeviceWorker implements PoolWorker {
  readonly name = 'device';
  private readonly events = new EventEmitter();
  private readonly bridge: Bridge;
  private readonly serverRoot: string;
  private readonly projectRoot: string;
  private readonly options: DevicePoolOptions;
  private session: Session | null = null;
  private launched: LaunchedApp | null = null;
  private launchedAt = 0;
  /** Settles when the worker has an app to send to: after a start, and after a relaunch. */
  private ready: Promise<void> = Promise.resolve();
  /** Aborted as the worker stops: a claim it is waiting on is given up, and nothing launches. */
  private shutdown = new AbortController();

  constructor(pool: PoolOptions, options: DevicePoolOptions) {
    this.options = options;
    this.bridge = Bridge.on(options.port ?? DEFAULT_PORT);
    this.bridge.silence = options.appTimeout ?? SILENCE_MS;
    this.projectRoot = pool.project.config.root;
    this.serverRoot = options.serverRoot ?? workspaceRoot(this.projectRoot);
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.events.on(event, callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.events.off(event, callback);
  }

  deserialize(data: unknown): unknown {
    return data;
  }

  async start(): Promise<void> {
    this.shutdown = new AbortController();
    this.bridge.hold(1);
    try {
      await this.connect();
    } catch (error) {
      this.bridge.hold(-1);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    // A replacement under way settles first, so it launches nothing once the worker has stopped.
    await this.ready.catch(() => {});
    const launched = this.launched;
    // An app this worker launched is about to stop: no other worker may be handed it.
    if (this.session && launched) this.bridge.drop(this.session);
    else if (this.session) this.bridge.release(this.session);
    this.session = null;
    this.launched = null;
    // An app this pool started goes with the run; one opened by hand stays for the next.
    await launched?.stop();
    this.bridge.hold(-1);
  }

  /**
   * Claim an app, starting one first where a launcher is given and none is free. An app that ends
   * before it connects fails the claim with what the launcher knows of why.
   */
  private async connect(): Promise<void> {
    const { launch } = this.options;
    const claim = (signal?: AbortSignal) =>
      this.bridge.claim((message) => this.receive(message), {
        platform: this.options.platform,
        timeout: this.options.connectTimeout ?? 60_000,
        root: this.projectRoot,
        signal: signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal,
      });
    if (!launch || this.bridge.hasFree(this.options.platform)) {
      this.session = await claim();
      return;
    }
    this.launchedAt = Date.now();
    const app = await launch.start({
      port: this.bridge.port,
      runId: randomUUID(),
      stateDir: mkdtempSync(path.join(tmpdir(), 'ng-native-device-tests-')),
    });
    this.launched = app;
    const early = app.exited.then((how) => {
      const error = new Error(`The app exited before it connected (${how}).`);
      return crashReportOf(launch, this.launchedAt).then((report) => {
        if (report) error.message += `\n${report}`;
        throw error;
      });
    });
    // An app that ended takes its claim with it: a claim left waiting would take the next app.
    const claiming = new AbortController();
    early.catch(() => claiming.abort());
    this.session = await Promise.race([claim(claiming.signal), early]);
    // From here a process that ends is a lost app at once, not after the silence is waited out.
    void app.exited.then((how) => {
      const session = this.session;
      if (this.launched !== app || !session) return;
      if (session.owed.size > 0) this.bridge.lose(session, `The app exited (${how}).`);
      else this.relaunch();
    });
  }

  /** What an app's session says to the worker: Vitest's messages, and the loss of the app. */
  private receive(message: unknown): void {
    const error = (message as { error?: unknown }).error;
    const launch = this.options.launch;
    if (!(error instanceof AppLost) || !launch) {
      this.events.emit('message', message);
      return;
    }
    // The relaunch starts at once, and the file fails with the crash report once it is found.
    this.relaunch();
    void crashReportOf(launch, this.launchedAt).then((report) => {
      if (report) error.message += `\n${report}`;
      this.events.emit('message', message);
    });
  }

  /**
   * Start a fresh app, which the next request waits for. A relaunch that fails fails that request;
   * with none to come it is no unhandled rejection.
   */
  private relaunch(): void {
    this.ready = this.replace();
    this.ready.catch(() => {});
  }

  /** The app is gone: a fresh one, on fresh state, for the files that remain. */
  private async replace(): Promise<void> {
    const dead = this.session;
    const launched = this.launched;
    this.session = null;
    this.launched = null;
    if (dead) this.bridge.drop(dead);
    await launched?.stop();
    if (this.shutdown.signal.aborted) return;
    await this.connect();
  }

  send(message: unknown): void {
    const request = message as {
      __vitest_worker_request__?: true;
      type?: string;
      context?: { files?: { filepath: string }[] };
    };
    // Vitest's answer to a call the app made, which the app's request is waiting on.
    if (!request.__vitest_worker_request__) {
      this.bridge.answer(message);
      return;
    }
    if (request.type === 'stop') {
      // The app stays open for the next run: there is nothing of it to stop.
      queueMicrotask(() => this.events.emit('message', response('stopped')));
      return;
    }
    // After a relaunch the worker's app is the new one, once `ready`.
    void this.ready.then(
      () => {
        const session = this.session;
        if (!session) return;
        if (request.type !== 'run' && request.type !== 'collect') {
          this.bridge.send(session, request);
          return;
        }
        // The bundles are fetched before the request goes: a Vitest request is answered in order,
        // so nothing else is sent meanwhile.
        return this.payloads(session, request.context?.files ?? []).then((files) => {
          // The app went while Metro bundled, and nothing was sent it: the app that replaces it
          // is sent the request instead.
          if (this.session !== session) this.send(message);
          else this.bridge.send(session, { ...request, files });
        });
      },
      (error: unknown) =>
        this.events.emit('message', {
          __vitest_worker_response__: true,
          type: request.type === 'start' ? 'started' : 'testfileFinished',
          error,
        }),
    );
  }

  /** What the app needs to run each file: the modules it lacks, from Metro. */
  private async payloads(
    session: Session,
    files: { filepath: string }[],
  ): Promise<Record<string, FilePayload>> {
    const payloads: Record<string, FilePayload> = {};
    // What this run sends, so a second file does not send a module the first already did.
    const have = new Set(session.defined);
    const hashes = new Map(session.hashes);
    for (const { filepath } of files) {
      const source = path.relative(this.serverRoot, filepath).split(path.sep).join('/');
      payloads[filepath] = await payload(session, source, filepath, have, hashes, this.projectRoot);
    }
    return payloads;
  }
}

async function payload(
  session: Session,
  source: string,
  filepath: string,
  have: Set<number>,
  hashes: Map<number, string>,
  projectRoot: string,
): Promise<FilePayload> {
  const url = bundleUrl(session.script, source);
  const failed = (error: string): FilePayload => ({
    entry: -1,
    modules: [],
    changed: [],
    mocks: {},
    url,
    error,
  });
  let text: string;
  try {
    const response = await fetch(url);
    text = await response.text();
    if (!response.ok) return failed(`Metro could not bundle ${source}:\n${metroError(text)}`);
  } catch (error) {
    return failed(`Metro could not be reached at ${url}: ${String(error)}`);
  }
  const modules = modulesOf(text);
  const entry = modules.find(({ name }) => source.endsWith(name.replace(/^(\.\.\/)+/, '')));
  if (!entry) return failed(`${source} is not in the bundle Metro sent for it`);
  const sent: SentModule[] = [];
  const changed: number[] = [];
  for (const { id, code, line } of modules) {
    const hash = createHash('sha1').update(code).digest('hex').slice(0, 16);
    const known = hashes.get(id);
    if (have.has(id) && (known === undefined || known === hash)) continue;
    if (have.has(id)) changed.push(id);
    sent.push({ id, code, hash, line });
    have.add(id);
    hashes.set(id, hash);
  }
  return {
    entry: entry.id,
    modules: sent,
    changed,
    mocks: mockIds(filepath, modules, projectRoot, session.platform),
    url,
  };
}

/** Each specifier `vi.mock` and its kin are given in a test file, as the module it resolves to. */
function mockIds(
  filepath: string,
  modules: BundleModule[],
  projectRoot: string,
  platform: string,
): Record<string, number> {
  const ids: Record<string, number> = {};
  let source: string;
  try {
    source = readFileSync(filepath, 'utf8');
  } catch {
    return ids;
  }
  // Metro names a module by its path from the project root; both sides as real paths, which a
  // project under a symlinked directory (macOS's /var, for one) differs in.
  const byPath = new Map(
    modules.map(({ id, name }) => [real(path.resolve(projectRoot, name)), id]),
  );
  for (const specifier of mockedSpecifiers(source)) {
    for (const candidate of candidates(filepath, specifier, platform)) {
      const id = byPath.get(real(candidate));
      if (id !== undefined) {
        ids[specifier] = id;
        break;
      }
    }
  }
  return ids;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * The files a specifier may name, from the file that names it, in the order Metro's resolver tries
 * them: for each extension in turn, the platform's own file (`dep.ios.ts`), then `.native`, then
 * the plain one.
 */
function candidates(from: string, specifier: string, platform: string): string[] {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const base = path.resolve(path.dirname(from), specifier);
    const withExtensions = (stem: string) =>
      EXTENSIONS.flatMap((extension) =>
        [`.${platform}`, '.native', ''].map((variant) => stem + variant + extension),
      );
    return [base, ...withExtensions(base), ...withExtensions(path.join(base, 'index'))];
  }
  // A package: the entries its manifest names, as Metro reads them first.
  const require = createRequire(from);
  let manifest: string;
  try {
    manifest = require.resolve(`${specifier}/package.json`);
  } catch {
    try {
      return [require.resolve(specifier)];
    } catch {
      return [];
    }
  }
  const fields = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  const exported = (fields['exports'] as Record<string, unknown> | undefined)?.['.'];
  const entries = [
    fields['react-native'],
    typeof exported === 'string' ? exported : undefined,
    ...(exported && typeof exported === 'object'
      ? Object.values(exported as Record<string, unknown>).filter(
          (value) => typeof value === 'string',
        )
      : []),
    fields['module'],
    fields['main'],
    'index.js',
  ].filter((entry): entry is string => typeof entry === 'string');
  return entries.map((entry) => path.resolve(path.dirname(manifest), entry));
}

function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** Metro's error as text: it answers a failed bundle with JSON. */
function metroError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? text;
  } catch {
    return text.slice(0, 2000);
  }
}

/**
 * The URL Metro serves a test file at, built like the app's own bundle so modules are shared, and
 * reached from this machine: an Android emulator's 10.0.2.2 is this machine's 127.0.0.1.
 */
function bundleUrl(script: string, source: string): string {
  const origin = (script.match(/^https?:\/\/[^/]+/)?.[0] ?? '').replace('10.0.2.2', '127.0.0.1');
  const query = script.split('?')[1] ?? '';
  const bundle = source.replace(/\.[cm]?[jt]sx?$/, '.bundle');
  return `${origin}/${bundle}?${query}&modulesOnly=true&runModule=true`;
}

/** The app a worker had is gone: closed, crashed or reloaded with an answer owed. */
class AppLost extends Error {
  override name = 'AppLost';
}

/** How long an app may go without a word while it owes an answer. */
const SILENCE_MS = 15_000;

const response = (type: string) => ({ __vitest_worker_response__: true, type });

/** An app connected to the pool: one launch of it, until it reloads. */
interface Session {
  id: string;
  platform: string;
  /** The URL of the app's own bundle, which test bundles are built like. */
  script: string;
  /** The ids of every module the app has. */
  defined: number[];
  /** The hash of each module a pool has sent the app. */
  hashes: [number, string][];
  /** Where the next request goes: the app's poll, held open. */
  waiting: ServerResponse | null;
  queue: { type?: string; [key: string]: unknown }[];
  /** The requests the app was sent and has not answered, by the id each was sent with. */
  owed: Set<number>;
  /** The id the next request is sent with. */
  nextRequest: number;
  /** The project of the worker that has the app, which its snapshot files are in. */
  root: string | null;
  /** The test files the app was sent to run, which an inline snapshot is written into. */
  files: Set<string>;
  lastType: string | undefined;
  lastSeen: number;
  /** The worker that has the app, and where its messages go. */
  claimant: ((message: unknown) => void) | null;
  watchdog: ReturnType<typeof setInterval> | null;
}

/** What the app sends with every poll. */
interface Poll {
  session: string;
  platform: string;
  script: string;
  defined: number[];
  hashes: Record<string, string>;
  reply: unknown;
}

/**
 * The HTTP server the apps poll, one per port for the life of the process: Vitest makes a worker
 * per run (and per file, when it isolates them), and they talk to the apps through it.
 */
class Bridge {
  private static readonly bridges = new Map<number, Bridge>();
  /** See `appTimeout`. */
  silence = SILENCE_MS;
  private readonly server: Server;
  readonly port: number;
  private readonly sessions = new Map<string, Session>();
  private readonly waiters: {
    platform?: string;
    take: (session: Session) => void;
  }[] = [];
  private readonly sockets = new Set<Socket>();
  private holds = 0;
  private readonly calls = new Map<string, ServerResponse>();

  private failure: Error | null = null;
  private readonly onFailure = new Set<(error: Error) => void>();

  static on(port: number): Bridge {
    let bridge = Bridge.bridges.get(port);
    if (!bridge) Bridge.bridges.set(port, (bridge = new Bridge(port)));
    return bridge;
  }

  private constructor(port: number) {
    this.port = port;
    this.server = createServer((request, response) => void this.receive(request, response));
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      if (this.holds === 0) socket.unref();
      socket.on('close', () => this.sockets.delete(socket));
    });
    // A port already taken, often by a Vitest still running, fails the run rather than leaving
    // it waiting for an app that is talking to the other process.
    this.server.on('error', (error) => {
      this.failure = error;
      for (const fail of this.onFailure) fail(error);
    });
    this.server.listen(port, '0.0.0.0');
    // Nothing holds the process until a worker waits on an app (see `hold`).
    this.server.unref();
  }

  private listenError(error: Error): Error {
    return new Error(
      `The device test pool cannot listen on port ${this.port}: ${error.message}. ` +
        'Another Vitest run may still be using it.',
    );
  }

  /**
   * Keep the process running while a worker waits on an app, and not after: a poll held open must
   * not keep Vitest from exiting once its run is done, and nothing else does while an app is
   * running a file, so without this Vitest would exit mid-run as if it had passed.
   */
  hold(change: 1 | -1): void {
    this.holds = Math.max(0, this.holds + change);
    for (const target of [this.server, ...this.sockets]) {
      if (this.holds > 0) target.ref();
      else target.unref();
    }
  }

  /**
   * Wait for an app no other worker has, on the platform asked for, and take it, for the worker
   * whose project is `root`. An abort of `signal` gives up the wait.
   */
  claim(
    claimant: (message: unknown) => void,
    {
      platform,
      timeout,
      root,
      signal,
    }: { platform?: string; timeout: number; root: string; signal?: AbortSignal },
  ): Promise<Session> {
    if (this.failure) return Promise.reject(this.listenError(this.failure));
    return new Promise((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(new Error('The claim was given up.'));
      };
      const fail = (error: Error) => {
        cleanup();
        reject(this.listenError(error));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `No ${platform ? `${platform} ` : ''}app free on the device test pool's port ${this.port} ` +
              `within ${timeout / 1000}s. Start Metro with EXPO_PUBLIC_DEVICE_TESTS=1 and open the ` +
              'app on a simulator or emulator.',
          ),
        );
      }, timeout);
      const waiter = {
        platform,
        take: (session: Session) => {
          cleanup();
          session.claimant = claimant;
          session.root = root;
          session.files.clear();
          resolve(session);
        },
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.onFailure.delete(fail);
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort);
      this.onFailure.add(fail);
      this.waiters.push(waiter);
      this.offer();
    });
  }

  /** Whether an app on the platform is connected and not claimed by a worker. */
  hasFree(platform: string | undefined): boolean {
    return [...this.sessions.values()].some(
      (session) =>
        !session.claimant && session.waiting && (!platform || session.platform === platform),
    );
  }

  /** Forget an app that is gone, so no worker is offered it. */
  drop(session: Session): void {
    this.unwatch(session);
    session.waiting?.end('null');
    session.waiting = null;
    session.claimant = null;
    session.root = null;
    session.files.clear();
    for (const [id, one] of this.sessions) if (one === session) this.sessions.delete(id);
  }

  release(session: Session): void {
    session.claimant = null;
    session.root = null;
    session.files.clear();
    this.offer();
  }

  /** Hand free apps to the workers waiting for one. */
  private offer(): void {
    for (const waiter of [...this.waiters]) {
      const free = [...this.sessions.values()].find(
        (session) =>
          !session.claimant &&
          session.waiting &&
          (!waiter.platform || session.platform === waiter.platform),
      );
      if (free) waiter.take(free);
    }
  }

  send(session: Session, message: { type?: string; [key: string]: unknown }): void {
    const files = message['files'];
    if (files && typeof files === 'object') {
      for (const file of Object.keys(files)) session.files.add(path.resolve(file));
    }
    session.queue.push(message);
    this.flush(session);
  }

  private flush(session: Session): void {
    if (!session.waiting || session.queue.length === 0) return;
    const response = session.waiting;
    session.waiting = null;
    response.setHeader('content-type', 'application/json');
    const message = session.queue.shift()!;
    // The app answers with the id, so an answer is matched to its request, and counted once.
    const id = session.nextRequest++;
    response.end(JSON.stringify({ ...message, deviceRequest: id }));
    session.lastType = message.type;
    session.owed.add(id);
    this.watch(session);
  }

  /**
   * Fail the request an app owes when it goes quiet: closed, crashed, or stopped in the debugger.
   * A running app sends a heartbeat every second; a test that blocks its JavaScript for longer
   * than this counts as gone too.
   */
  private watch(session: Session): void {
    session.lastSeen = Date.now();
    session.watchdog ??= setInterval(
      () => {
        if (Date.now() - session.lastSeen < this.silence) return;
        this.abandon(
          session,
          `The app stopped answering for ${this.silence / 1000}s: it closed or crashed.`,
        );
      },
      Math.min(1000, this.silence / 4),
    );
    // Node's timer: an app that typechecks this with the DOM's types sees a number.
    (session.watchdog as { unref?: () => void }).unref?.();
  }

  private unwatch(session: Session): void {
    if (session.watchdog) clearInterval(session.watchdog);
    session.watchdog = null;
  }

  /** An app known to be gone: the request it owes fails now. */
  lose(session: Session, reason: string): void {
    this.abandon(session, reason);
  }

  private abandon(session: Session, reason: string): void {
    this.unwatch(session);
    if (session.owed.size === 0) return;
    session.owed.clear();
    session.claimant?.({
      __vitest_worker_response__: true,
      type: session.lastType === 'start' ? 'started' : 'testfileFinished',
      error: new AppLost(reason),
    });
  }

  /** Vitest's answer to one of an app's calls: `{ t: 's', i, r }` or `{ t: 's', i, e }`. */
  answer(message: unknown): void {
    const { i } = message as { i?: string };
    const response = i === undefined ? undefined : this.calls.get(i);
    if (!response) return;
    this.calls.delete(i!);
    response.setHeader('content-type', 'application/json');
    // An error Vitest threw: JSON keeps none of an Error's own fields.
    response.end(
      JSON.stringify(message, (_, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      ),
    );
  }

  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of request) body += chunk;
    let message: Record<string, unknown> | null;
    try {
      message = JSON.parse(body || 'null') as Record<string, unknown> | null;
    } catch {
      response.writeHead(400).end();
      return;
    }
    const session = this.sessions.get(String(message?.['session'] ?? ''));
    if (session) session.lastSeen = Date.now();
    if (request.url === '/alive') response.end();
    else if (request.url === '/rpc') this.call(session, message, response);
    else if (request.url === '/files') this.files(session, message, response);
    else this.poll(message as unknown as Poll, response);
  }

  /**
   * A call an app's runner makes to Vitest, held open until Vitest answers: the runner waits for
   * each, so Vitest has the tests collected before it hears how they went.
   */
  private call(
    session: Session | undefined,
    message: Record<string, unknown> | null,
    response: ServerResponse,
  ): void {
    const call = message?.['call'] as { i?: string } | undefined;
    if (!session?.claimant || !call) {
      response.end('{}');
      return;
    }
    if (call.i) this.calls.set(call.i, response);
    else response.end('{}');
    session.claimant(coverageFile(restoreLinks(call)));
  }

  /**
   * Snapshot files, which the app reads and writes through here: only an app a worker has, and
   * only its project's `.snap` files and the test files it was sent.
   */
  private files(
    session: Session | undefined,
    message: Record<string, unknown> | null,
    response: ServerResponse,
  ): void {
    response.setHeader('content-type', 'application/json');
    try {
      response.end(JSON.stringify({ result: snapshotFile(session, message ?? {}) }));
    } catch (error) {
      response.end(JSON.stringify({ error: String(error) }));
    }
  }

  /** A poll: it carries the answer to the last request, and waits for the next one. */
  private poll(poll: Poll | null, response: ServerResponse): void {
    if (!poll?.session) {
      response.end('null');
      return;
    }
    let session = this.sessions.get(poll.session);
    if (!session) {
      session = this.open(poll);
    }
    session.defined = poll.defined ?? [];
    session.hashes = Object.entries(poll.hashes ?? {}).map(([id, hash]) => [Number(id), hash]);
    session.script = poll.script;
    session.lastSeen = Date.now();
    // An older poll still held is one the app has given up on.
    session.waiting?.end('null');
    session.waiting = response;
    // A poll whose connection closes is not one a request can go on: the app went with it.
    const held = session;
    response.on('close', () => {
      if (held.waiting === response) held.waiting = null;
    });
    this.unwatch(session);
    // An answer counts only for a request the app was sent and has not answered: a repeat of an
    // answer, as a poll the app sends again carries, answers nothing.
    const reply = poll.reply as { deviceRequest?: unknown } | null;
    if (
      reply &&
      typeof reply.deviceRequest === 'number' &&
      session.owed.delete(reply.deviceRequest)
    ) {
      const { deviceRequest: _, ...answer } = reply;
      session.claimant?.(answer);
    }
    this.flush(session);
    // A request still owed keeps the watchdog on, though this poll sent nothing: a repeated reply.
    if (session.owed.size > 0) this.watch(session);
    this.offer();
  }

  /**
   * A new launch of an app. The same platform and Metro is no sign it is an earlier launch come
   * back: a second simulator running the app looks the same, and nothing in a poll names the
   * device. An app that reloads with an answer owed fails as one that went quiet does, after the
   * silence; an earlier launch no worker has and with no poll held is forgotten.
   */
  private open(poll: Poll): Session {
    for (const [id, old] of this.sessions) {
      if (!old.claimant && !old.waiting) this.sessions.delete(id);
    }
    const session: Session = {
      id: poll.session,
      platform: poll.platform,
      script: poll.script,
      defined: [],
      hashes: [],
      waiting: null,
      queue: [],
      owed: new Set(),
      nextRequest: 1,
      root: null,
      files: new Set(),
      lastType: undefined,
      lastSeen: Date.now(),
      claimant: null,
      watchdog: null,
    };
    this.sessions.set(poll.session, session);
    return session;
  }
}

/**
 * Read, write or remove a snapshot file, for the app. Only a `.snap` file, or a test file itself,
 * which an inline snapshot is written into.
 */
function snapshotFile(
  session: Session | undefined,
  message: Record<string, unknown>,
): string | null {
  const requested = String(message['path'] ?? '');
  // Normalised once: the path checked is the path touched, as the kernel would follow a link
  // before a `..` that `path.resolve` has already folded away.
  const file = normalised(requested);
  if (!session?.claimant || !session.root || !path.isAbsolute(file) || !permitted(session, file)) {
    throw new Error(`Not a snapshot file: ${requested}`);
  }
  switch (message['op']) {
    case 'read':
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    case 'write':
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, String(message['content'] ?? ''));
      return null;
    case 'remove':
      rmSync(file, { force: true });
      return null;
    default:
      throw new Error(`Unknown snapshot file operation ${String(message['op'])}`);
  }
}

const normalised = (file: string): string => (path.isAbsolute(file) ? path.resolve(file) : file);

/**
 * Whether the app may touch `file`: a test file it was sent, or a `.snap` file in its worker's
 * project and outside its packages, whichever way a symlink on the path points.
 */
function permitted(session: Session, file: string): boolean {
  const resolved = file;
  if (session.files.has(resolved)) return true;
  const target = realPath(resolved);
  return (
    target !== null &&
    snapshotPath(resolved) &&
    snapshotPath(target) &&
    inside(session.root!, resolved) &&
    inside(real(session.root!), target)
  );
}

/** A `.snap` file outside any package. */
const snapshotPath = (file: string): boolean =>
  /\.snap$/.test(file) && !file.split(path.sep).includes('node_modules');

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * `file`'s real path, through its nearest entry that exists: a file to write may not yet. Null for
 * a link that points nowhere, which a write would follow to wherever it names.
 */
function realPath(file: string): string | null {
  let existing = file;
  while (!lstatSync(existing, { throwIfNoEntry: false }) && path.dirname(existing) !== existing) {
    existing = path.dirname(existing);
  }
  try {
    return path.join(realpathSync(existing), path.relative(existing, file));
  } catch {
    return null;
  }
}

/** What a launcher can say of a lost app's crash: nothing, rather than a failure of its own. */
async function crashReportOf(launch: AppLauncher, since: number): Promise<string | undefined> {
  try {
    return await launch.crashReport?.(since);
  } catch {
    return undefined;
  }
}

/** Coverage files written for Vitest, which reads them as it reports: removed when it exits. */
const coverageFiles = new Set<string>();
process.once('exit', () => {
  for (const file of coverageFiles) rmSync(file, { force: true });
});

/**
 * Coverage as Vitest's istanbul provider takes it: a Vitest worker writes what it counted to a file
 * and sends the file's path, so the pool does that for the app.
 */
function coverageFile(message: unknown): unknown {
  const call = message as { m?: string; a?: [{ coverage?: unknown }] };
  const meta = call.a?.[0];
  if (call.m !== 'onAfterSuiteRun' || !meta?.coverage || typeof meta.coverage === 'string') {
    return message;
  }
  const file = path.join(tmpdir(), `ng-native-device-coverage-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(withinSource(meta.coverage as Record<string, FileCoverage>)));
  coverageFiles.add(file);
  meta.coverage = file;
  return message;
}

interface Location {
  start: { line: number };
}

interface FileCoverage {
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<string, { loc: Location }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc: Location }>;
  b: Record<string, number[]>;
}

/**
 * Coverage of the source as written: what the Metro transform adds in development (the hot reload
 * code at the end of each file) has no line of its own in the source, and is left out.
 */
export function withinSource(coverage: Record<string, FileCoverage>): Record<string, FileCoverage> {
  for (const [file, data] of Object.entries(coverage)) {
    let lines: number;
    try {
      lines = readFileSync(file, 'utf8').split('\n').length;
    } catch {
      continue;
    }
    const keep = (line: number) => line <= lines;
    for (const key of Object.keys(data.statementMap)) {
      if (keep(data.statementMap[key]!.start.line)) continue;
      delete data.statementMap[key];
      delete data.s[key];
    }
    for (const key of Object.keys(data.fnMap)) {
      if (keep(data.fnMap[key]!.loc.start.line)) continue;
      delete data.fnMap[key];
      delete data.f[key];
    }
    for (const key of Object.keys(data.branchMap)) {
      if (keep(data.branchMap[key]!.loc.start.line)) continue;
      delete data.branchMap[key];
      delete data.b[key];
    }
  }
  return coverage;
}

type TaskTree = { tasks?: TaskTree[]; file?: TaskTree; suite?: TaskTree };

/** An app sends task trees without their links back up (see `run.ts`): put them back. */
function restoreLinks(message: unknown): unknown {
  const rpc = message as { m?: string; a?: unknown[] };
  if (rpc.m === 'onQueued' && rpc.a?.[0]) {
    const file = rpc.a[0] as TaskTree;
    link(file, file, undefined);
    return message;
  }
  if (rpc.m !== 'onCollected') return message;
  // `onCollected(files)`: the files are its one argument.
  for (const file of (rpc.a?.[0] ?? []) as TaskTree[]) link(file, file, undefined);
  return message;
}

function link(task: TaskTree, file: TaskTree, suite: TaskTree | undefined): void {
  task.file = file;
  if (suite) task.suite = suite;
  task.tasks?.forEach((child) => link(child, file, task));
}

/**
 * The root Expo's Metro serves from: the nearest directory above the project that declares
 * workspaces, or the project itself.
 */
function workspaceRoot(project: string): string {
  // ponytail: npm/yarn `workspaces` and pnpm's file only; Expo's resolver also reads Bun's and
  // Lerna's. Pass `serverRoot` where it guesses wrong.
  for (let dir = path.dirname(project); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).workspaces) return dir;
  }
  return project;
}
