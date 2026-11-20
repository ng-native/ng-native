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
import { sleep, tail } from './command.ts';

export interface MetroServer {
  port: number;
  stop(): Promise<void>;
}

const servers = new Map<string, Promise<MetroServer>>();

/** The project's Metro, started on first use. Coverage asks Metro to instrument the app's code. */
export function metroFor(projectRoot: string, { coverage = false } = {}): Promise<MetroServer> {
  let server = servers.get(projectRoot);
  if (!server) {
    server = startMetro(projectRoot, coverage);
    servers.set(projectRoot, server);
    // A start that failed is not kept: the next worker tries again.
    server.catch(() => servers.delete(projectRoot));
  }
  return server;
}

/** Stop every Metro this process started. */
export async function stopMetro(): Promise<void> {
  const started = [...servers.values()];
  servers.clear();
  await Promise.all(started.map((server) => server.then((s) => s.stop()).catch(() => {})));
}

async function startMetro(projectRoot: string, coverage: boolean): Promise<MetroServer> {
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
    if (await running(port)) return { port, stop };
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Metro for the device tests did not start within two minutes:\n${output}`);
    }
  }
}

async function running(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
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
