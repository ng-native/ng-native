/**
 * The Metro a device run loads its app and tests from, which the pool starts itself, as Vitest's
 * browser mode starts Vite: `expo start` in the project with `EXPO_PUBLIC_DEVICE_TESTS=1`, on a
 * free port, so it never meets the dev server a person has running on 8081. One per project for
 * the life of the Vitest process, shared by its iOS, Android and macOS projects, and stopped when
 * Vitest closes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { keepLines, progress, sleep } from './command.ts';

export interface MetroServer {
  port: number;
  stop(): Promise<void>;
  /** Settles when Metro's process ends, however it ends. */
  exited: Promise<string>;
  /** The last lines Metro printed. */
  output(): string;
}

const servers = new Map<string, Promise<MetroServer>>();

/**
 * The project's Metro for a pool, started on first use: one for each pool port, since Metro tells
 * the app which pool to poll. Coverage asks Metro to instrument the app's code, and
 * `poolPort` is the port the app's test host polls, which Metro tells it.
 */
export function metroFor(
  projectRoot: string,
  { coverage = false, poolPort }: { coverage?: boolean; poolPort?: number } = {},
): Promise<MetroServer> {
  // One per pool too: the Metro tells the app which pool to poll.
  const key = `${projectRoot}\0${poolPort ?? ''}`;
  let server = servers.get(key);
  if (!server) {
    const started = startMetro(projectRoot, coverage, poolPort);
    server = started;
    servers.set(key, started);
    // A start that failed, or a Metro that has since ended, is not kept: the next worker starts
    // another. Only this one: an earlier Metro ending must not drop the one that replaced it.
    const forget = () => {
      if (servers.get(key) === started) servers.delete(key);
    };
    started.then((metro) => metro.exited.then(forget), forget);
  }
  return server;
}

/** Stop every Metro this process started. */
export async function stopMetro(): Promise<void> {
  const started = [...servers.values()];
  servers.clear();
  await Promise.all(started.map((server) => server.then((s) => s.stop()).catch(() => {})));
}

async function startMetro(
  projectRoot: string,
  coverage: boolean,
  poolPort: number | undefined,
): Promise<MetroServer> {
  const started = Date.now();
  const port = await freePort();
  const cli = createRequire(`${projectRoot}/package.json`).resolve('expo/bin/cli');
  // Its own process group, so stopping it stops the workers Metro starts too.
  const child = spawn(process.execPath, [cli, 'start', '--port', String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      EXPO_PUBLIC_DEVICE_TESTS: '1',
      ...(coverage && { DEVICE_TESTS_COVERAGE: '1' }),
      // Which Metro tells the app's test host, for it to poll: see `withDeviceTests`.
      ...(poolPort !== undefined && { NG_NATIVE_DEVICE_TESTS_POOL_PORT: String(poolPort) }),
      // Not a person's terminal: no prompts, no QR code.
      EXPO_NO_TELEMETRY: '1',
    },
  });
  let output = '';
  // Decoded per stream, so a character split across two chunks stays whole.
  for (const stream of [child.stdout!, child.stderr!]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => (output = keepLines(output + chunk, 60)));
  }
  const exited = new Promise<string>((resolve) => {
    child.once('error', (error) => resolve(`it could not be started: ${error.message}`));
    child.once('close', (code, signal) => resolve(signal ? `signal ${signal}` : `status ${code}`));
  });
  const stop = () => stopGroup(child, exited);
  process.once('exit', () => killGroup(child, 'SIGKILL'));

  const deadline = Date.now() + 120_000;
  for (;;) {
    const ended = await Promise.race([exited, sleep(500).then(() => null)]);
    if (ended !== null) {
      throw new Error(`Metro for the device tests stopped as it started (${ended}):\n${output}`);
    }
    if (await running(port)) {
      progress('metro', `serving on port ${port}`, started);
      return { port, stop, exited, output: () => output };
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Metro for the device tests did not start within two minutes:\n${output}`);
    }
  }
}

/**
 * Bundle the app on `port` as a phone asks for it, for a launcher to wait on while the device boots
 * and the app installs. Metro starts with no cache on CI and takes minutes there to bundle the app
 * from cold; done here, the app's own request is answered from the bundle Metro keeps. Settles
 * however the fetch ends, with whether Metro sent the bundle: a bundle that failed fails again on
 * the app's request, which says why.
 */
export async function warmBundle(
  port: number,
  platform: 'ios' | 'android',
  signal?: AbortSignal,
): Promise<boolean> {
  const started = Date.now();
  // The query the app's own request has, so Metro builds the same graph and keeps it.
  const query = `platform=${platform}&dev=true&lazy=true&minify=false&modulesOnly=false&runModule=true`;
  let warmed = false;
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/.expo/.virtual-metro-entry.bundle?${query}`,
      { signal: AbortSignal.any([AbortSignal.timeout(WARM_MS), ...(signal ? [signal] : [])]) },
    );
    await response.arrayBuffer();
    warmed = response.ok;
  } catch {
    // The app's own request can still build the bundle.
  }
  if (!warmed) {
    progress(platform, 'Metro bundle warmup did not finish', started);
    return false;
  }
  // The app asks Metro's status first and gives up for good after three slow answers, which a
  // Metro still busy after the bundle, on a loaded runner, can give: wait for one at once.
  const deadline = Date.now() + PROMPT_WAIT_MS;
  while (Date.now() < deadline && !signal?.aborted && !(await running(port, PROMPT_MS))) {
    // A refusal comes back at once: asked again after a pause, not in a busy loop.
    await sleep(250);
  }
  progress(platform, 'Metro bundle warmup finished', started);
  return true;
}

/** How long a warm-up may take before the app is launched anyway. */
const WARM_MS = 5 * 60_000;
/** An answer to the status this quick is one the app takes, and how long to wait for one. */
const PROMPT_MS = 1000;
const PROMPT_WAIT_MS = 60_000;

async function running(port: number, within = 2000): Promise<boolean> {
  try {
    // Bounded, the body included: a Metro that takes the connection and never answers is not one
    // to wait on past the start's own deadline.
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(within),
    });
    return (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

/** SIGTERM to Metro's group, then SIGKILL to whatever of it is left after three seconds. */
async function stopGroup(child: ChildProcess, exited: Promise<string>): Promise<void> {
  killGroup(child, 'SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  killGroup(child, 'SIGKILL');
  await exited;
}

/** A port nothing is listening on, from the system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
