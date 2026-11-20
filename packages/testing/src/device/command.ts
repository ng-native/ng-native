/**
 * Running the tools a device run needs (`xcrun`, `adb`, `xcodebuild`, Expo's CLI) from the pool:
 * each command's output is kept, and a failure names the command and ends with what it printed.
 */
import { spawn } from 'node:child_process';
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk;
      if (options.log) appendFileSync(options.log, chunk);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', (error) =>
      reject(
        error.name === 'AbortError'
          ? new Error(`${command} was stopped: the run ended.`)
          : new Error(`${command} could not be started: ${error.message}`),
      ),
    );
    child.once('close', (status) => {
      // Rejected here too, should the stop not have come as an error first.
      if (options.signal?.aborted) reject(new Error(`${command} was stopped: the run ended.`));
      else if (status === 0 || options.allowFailure) resolve({ status, output });
      else
        reject(
          new Error(`${[command, ...args].join(' ')} failed (status ${status}):\n${tail(output)}`),
        );
    });
  });
}

/** The last lines of some output, which is where a tool says what went wrong. */
export function tail(output: string, lines = 30): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n');
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
