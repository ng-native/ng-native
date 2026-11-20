/**
 * Running the tools a device run needs (`xcrun`, `adb`, `xcodebuild`, Expo's CLI) from the pool:
 * each command's output is kept, and a failure names the command and ends with what it printed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** A file the output is appended to as well, for a long build. */
  log?: string;
  /** Resolve with the output even when the command fails. */
  allowFailure?: boolean;
  /** Stops the command, which then rejects. */
  signal?: AbortSignal;
}

export interface CommandResult {
  status: number | null;
  output: string;
}

/** Run a command to its end, with its output. A failure rejects, unless `allowFailure`. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    // Its own process group, so a stop reaches what it started (a Gradle daemon's client, a
    // compiler), and nothing it left writes after the stop is answered.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const stop = () => stopGroup(child);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk;
      if (options.log) appendFileSync(options.log, chunk);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', (error) =>
      reject(new Error(`${command} could not be started: ${error.message}`)),
    );
    // At `close`, once the whole group has gone: what waits on a stop (the next prebuild, a
    // folder removed) starts after the last write.
    child.once('close', (status) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(new Error(`${command} was stopped: the run ended.`));
      else if (status === 0 || options.allowFailure) resolve({ status, output });
      else
        reject(
          new Error(`${[command, ...args].join(' ')} failed (status ${status}):\n${tail(output)}`),
        );
    });
  });
}

/** How long a stopped group has to end on SIGTERM before it is killed. */
const STOP_GRACE_MS = 5000;

/** SIGTERM to the child's process group, then SIGKILL to whatever of it is left. */
function stopGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    child.kill();
    return;
  }
  const group = -child.pid;
  const signal = (name: NodeJS.Signals | 0) => {
    try {
      process.kill(group, name);
      return true;
    } catch {
      return false; // The group has gone.
    }
  };
  if (!signal('SIGTERM')) return;
  setTimeout(() => {
    if (signal(0)) signal('SIGKILL');
  }, STOP_GRACE_MS).unref();
}

/** The last lines of some output, which is where a tool says what went wrong. */
export function tail(output: string, lines = 30): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n');
}

/** A line on the pool's progress, with the seconds since `since`: a first run can take minutes. */
export function progress(os: string, message: string, since?: number): void {
  const took = since === undefined ? '' : ` (${((Date.now() - since) / 1000).toFixed(1)}s)`;
  console.log(`[device tests ${os}] ${message}${took}`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
