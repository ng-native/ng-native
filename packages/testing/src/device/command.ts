/**
 * Running the tools a device run needs (`xcrun`, `adb`, `xcodebuild`, Expo's CLI) from the pool:
 * each command's output is kept, and a failure names the command and ends with what it printed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';

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
    let stopped: Promise<void> = Promise.resolve();
    const stop = () => {
      stopped = stopGroup(child);
    };
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
    // A stop rejects once the whole group has gone, which `close` alone does not show (a member
    // can let go of the output and live on): what waits on it (the next prebuild, a folder
    // removed) starts after the last write.
    child.once('close', (status) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) {
        void stopped.then(() => reject(new Error(`${command} was stopped: the run ended.`)));
      } else if (status === 0 || options.allowFailure) resolve({ status, output });
      else
        reject(
          new Error(`${[command, ...args].join(' ')} failed (status ${status}):\n${tail(output)}`),
        );
    });
  });
}

/** How long a stopped group has to end on SIGTERM before it is killed. */
const STOP_GRACE_MS = 5000;

/**
 * SIGTERM to the child's process group, then SIGKILL to whatever of it is left; resolves once
 * none of the group is running.
 */
async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    child.kill();
    return;
  }
  const pgid = child.pid;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pgid, name);
      return true;
    } catch {
      return false; // The group has gone.
    }
  };
  const running = () => groupRunning(pgid);
  if (!signal('SIGTERM')) return;
  const ends = Date.now() + STOP_GRACE_MS;
  while (running() && Date.now() < ends) await sleep(50);
  // Sent whatever the wait last saw: a scan of /proc can miss a member forked during it, and
  // SIGKILL reaches every member, a zombie harmlessly, and leaves none to fork another. It cannot
  // be ignored; the wait after it is bounded for a process stuck in the kernel.
  if (!signal('SIGKILL')) return;
  for (let tries = 0; tries < 100 && running(); tries++) await sleep(50);
}

/**
 * Whether any process of group `pgid` is running. On Linux, a zombie does not count: where
 * nothing reaps orphans (a container's PID 1), a group of zombies would otherwise never end.
 */
function groupRunning(pgid: number): boolean {
  if (process.platform === 'linux') {
    let entries: string[];
    try {
      entries = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
    } catch {
      entries = [];
    }
    if (entries.length > 0) {
      return runningInGroup(
        entries.map((pid) => {
          try {
            return readFileSync(`/proc/${pid}/stat`, 'utf8');
          } catch {
            return ''; // Gone since the listing.
          }
        }),
        pgid,
      );
    }
  }
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether any of `/proc/<pid>/stat`'s lines is of a process in group `pgid` that is not a zombie. */
export function runningInGroup(stats: readonly string[], pgid: number): boolean {
  return stats.some((stat) => {
    // `pid (comm) state ppid pgrp ...`, where comm can hold spaces and parentheses.
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(pgrp) === pgid && state !== 'Z' && state !== 'X';
  });
}

/**
 * Output as it arrives, cut to its last `lines` lines with its line breaks kept, so the next chunk
 * carries on from it: `tail` trims, which would join one chunk's last line to the next's first.
 */
export function keepLines(output: string, lines: number): string {
  const parts = output.split('\n');
  // A break that ends the output leaves an empty last part, which is not a line of its own.
  const counted = parts.at(-1) === '' ? lines + 1 : lines;
  return parts.length > counted ? parts.slice(-counted).join('\n') : output;
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
