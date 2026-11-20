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
import { progress, sleep, tail } from './command.ts';

export interface MetroServer {
  port: number;
  stop(): Promise<void>;
  /** Settles when Metro's process ends, however it ends. */
  exited: Promise<string>;
}

const servers = new Map<string, Promise<MetroServer>>();

/**
 * The project's Metro, started on first use. Coverage asks Metro to instrument the app's code, and
 * `poolPort` is the port the app's test host polls, which Metro tells it.
 */
export function metroFor(
  projectRoot: string,
  { coverage = false, poolPort }: { coverage?: boolean; poolPort?: number } = {},
): Promise<MetroServer> {
  let server = servers.get(projectRoot);
  if (!server) {
    const started = startMetro(projectRoot, coverage, poolPort);
    server = started;
    servers.set(projectRoot, started);
    // A start that failed, or a Metro that has since ended, is not kept: the next worker starts
    // another. Only this one: an earlier Metro ending must not drop the one that replaced it.
    const forget = () => {
      if (servers.get(projectRoot) === started) servers.delete(projectRoot);
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
  child.stdout!.on('data', (chunk: Buffer) => (output = tail(output + chunk, 60)));
  child.stderr!.on('data', (chunk: Buffer) => (output = tail(output + chunk, 60)));
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
      return { port, stop, exited };
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Metro for the device tests did not start within two minutes:\n${output}`);
    }
  }
}

async function running(port: number): Promise<boolean> {
  try {
    // Bounded, the body included: a Metro that takes the connection and never answers is not one
    // to wait on past the start's own deadline.
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(2000),
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
