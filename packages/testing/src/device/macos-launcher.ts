/**
 * The launcher for a macOS desktop host: `ng-native-desktop run` with the test environment the
 * host's contract names (see `launcher.ts`), and the crash report a lost host leaves.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AppLauncher, LaunchRequest, LaunchedApp } from './launcher.ts';

export interface MacosLauncherOptions {
  /** The command that runs the desktop host. Default: `ng-native-desktop`, from the project. */
  command?: string;
  /** Arguments before `run`. Default none. */
  args?: readonly string[];
  /** The Metro port the host loads its bundle from. Default: the Metro the pool started. */
  metroPort?: number;
  /** The directory the command runs in. Default: the current directory. */
  cwd?: string;
  /** Environment added to the process's own. */
  env?: Readonly<Record<string, string>>;
  /** Where macOS writes crash reports. Default `~/Library/Logs/DiagnosticReports`. */
  reports?: string;
  /**
   * The start of the executable's name in a report. Default `ngn-macos` and the name of each
   * `<name>.app` that `run` has made in `.expo/ng-native-desktop/dev` of `cwd`, which the host
   * runs as.
   */
  executable?: string | readonly string[];
  /** How long to look for a crash report after a crash, in milliseconds. Default 5 seconds. */
  reportWait?: number;
}

/** Environment the host reads for a test launch. */
export function testEnvironment(request: LaunchRequest): Record<string, string> {
  return {
    NGN_TESTS: '1',
    NGN_STATE_DIR: request.stateDir,
    NGN_RUN_ID: request.runId,
    NGN_TESTS_FAKE_SYSTEM_UI: '1',
  };
}

/** The newest crash report for `executable` written at or after `since`, or undefined. */
export function crashReportSince(
  directory: string,
  executable: string | readonly string[],
  since: number,
): string | undefined {
  const prefixes = typeof executable === 'string' ? [executable] : executable;
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return undefined;
  }
  let newest: { file: string; time: number } | undefined;
  for (const name of names) {
    if (!prefixes.some((prefix) => name.startsWith(prefix)) || !/\.(ips|crash)$/.test(name))
      continue;
    const file = path.join(directory, name);
    const time = statSync(file).mtimeMs;
    if (time >= since && (!newest || time > newest.time)) newest = { file, time };
  }
  return newest && `Crash report: ${newest.file}`;
}

/** The host executables a dev run of the app in `cwd` has made: `ngn-macos`, and each app's name. */
function hostExecutables(cwd: string): string[] {
  try {
    const apps = readdirSync(path.join(cwd, '.expo', 'ng-native-desktop', 'dev'));
    return [
      'ngn-macos',
      ...apps.filter((name) => name.endsWith('.app')).map((n) => n.slice(0, -4)),
    ];
  } catch {
    return ['ngn-macos'];
  }
}

export function macosLauncher(options: MacosLauncherOptions = {}): AppLauncher {
  const reports = options.reports ?? path.join(homedir(), 'Library/Logs/DiagnosticReports');
  return {
    start(request): LaunchedApp {
      const child: ChildProcess = spawn(
        options.command ?? 'ng-native-desktop',
        [...(options.args ?? []), 'run', '--port', String(options.metroPort ?? request.metroPort)],
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env, ...testEnvironment(request) },
          stdio: 'ignore',
        },
      );
      const exited = new Promise<string>((resolve) => {
        child.once('error', (error) => resolve(`it could not be started: ${error.message}`));
        child.once('exit', (code, signal) =>
          resolve(signal ? `signal ${signal}` : `status ${code ?? 'unknown'}`),
        );
      });
      return {
        exited,
        async stop() {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }
          rmSync(request.stateDir, { recursive: true, force: true });
        },
      };
    },
    async crashReport(since) {
      const deadline = Date.now() + (options.reportWait ?? 5000);
      for (;;) {
        const found = crashReportSince(
          reports,
          options.executable ?? hostExecutables(options.cwd ?? process.cwd()),
          since,
        );
        if (found || Date.now() >= deadline) return found;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
  };
}
