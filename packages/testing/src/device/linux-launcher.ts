/**
 * The launcher for the Linux desktop host (`ngn-linux`, the GTK host): the host started on the dev
 * server's Linux bundle with the test environment the host's contract names (see `launcher.ts`),
 * on a display of its own where asked. On Linux it runs the host directly; on a Mac it runs it in
 * the AlmaLinux 9 image the host is built in (`packages/desktop/native/docker`), which reaches the
 * pool and Metro on the Mac through ports it forwards.
 *
 * Linux has no crash report location of its own, so what the pool names for a lost host is the
 * end of the host's output.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import type { AppLauncher, LaunchRequest, LaunchedApp } from './launcher.ts';
import { testEnvironment } from './macos-launcher.ts';

/**
 * Where the host's windows go: `inherit` uses the caller's `DISPLAY` or `WAYLAND_DISPLAY`, `xvfb`
 * starts an X server of its own, and `weston` a headless Wayland compositor of its own, each
 * 1280 by 800 at scale 1 and gone with the host.
 */
export type LinuxDisplay = 'inherit' | 'xvfb' | 'weston';

export interface LinuxLauncherOptions {
  /**
   * The host executable, `<build>/gtk/ngn-linux`. Default `NGN_DESKTOP_HOST`. In a container it is
   * mounted at the same path, so it must be under a folder the container runtime shares (the home
   * folder, for Colima and Docker Desktop).
   */
  host?: string;
  /** Arguments before the bundle. Default none. */
  args?: readonly string[];
  /** The bundle the host loads. Default: the dev server's Linux bundle on `metroPort`. */
  bundle?: string;
  /** The Metro port the default bundle is loaded from. Default `RCT_METRO_PORT`, or 8081. */
  metroPort?: number;
  /**
   * Where the host's windows go. Default `inherit` where `DISPLAY` or `WAYLAND_DISPLAY` is set and
   * no container is used, otherwise `weston`.
   */
  display?: LinuxDisplay;
  /**
   * The image to run the host in, or `false` to run it directly. Default: `ngn-el9` on any OS but
   * Linux, and none on Linux.
   */
  container?: string | false;
  /** The container command. Default `docker`. */
  docker?: string;
  /**
   * The directory the host runs in, and the base a relative `bundle` file is resolved against, in a
   * container too. Default: the current directory.
   */
  cwd?: string;
  /** How long `stop` waits after SIGTERM before it kills what is left, in milliseconds. Default 3000. */
  stopGraceMs?: number;
  /** Environment added to the process's own. */
  env?: Readonly<Record<string, string>>;
}

/** The dev server's Linux bundle, the entry Expo's own clients load. */
export function linuxBundleUrl(port: number): string {
  return `http://127.0.0.1:${port}/.expo/.virtual-metro-entry.bundle?platform=linux&dev=true`;
}

/**
 * A `GApplication` id unique to the launch, so single-instance activation never joins another
 * run: a run id is letters, digits and dashes, and an id's elements take no dash at their start.
 */
export function testApplicationId(runId: string): string {
  return `dev.ngnative.tests.run_${runId.replace(/-/g, '_')}`;
}

/**
 * The XDG folders and the temporary folder under the launch's state directory, so the host keeps
 * nothing of an earlier run and leaves nothing behind.
 */
export function linuxStateEnvironment(stateDir: string): Record<string, string> {
  return {
    XDG_DATA_HOME: path.posix.join(stateDir, 'data'),
    XDG_CONFIG_HOME: path.posix.join(stateDir, 'config'),
    XDG_CACHE_HOME: path.posix.join(stateDir, 'cache'),
    XDG_STATE_HOME: path.posix.join(stateDir, 'state'),
    TMPDIR: path.posix.join(stateDir, 'tmp'),
  };
}

/**
 * The shell script a launch runs: the state folders made, the display started, then the host
 * (`"$@"`) run until it exits or is sent SIGTERM, which it is passed. It exits with the host's
 * status, or 128 plus the signal that ended it, and stops the display it started.
 */
export function sessionScript(display: LinuxDisplay, forward: readonly number[] = []): string {
  const lines = [
    'set -u',
    'mkdir -p "$NGN_STATE_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$TMPDIR"',
    'work="$(mktemp -d)"',
    'pids=""',
    'cleanup() { for pid in $pids; do kill "$pid" 2>/dev/null; done; rm -rf "$work"; }',
    'trap cleanup EXIT',
  ];
  if (forward.length) {
    // The pool and Metro listen on the machine that runs Vitest, which a container reaches as
    // host.docker.internal; the app and the host ask for them at 127.0.0.1.
    lines.push(
      `node -e ${shellQuote(FORWARDER)} ${forward.join(' ')} &`,
      'pids="$pids $!"',
      'for _ in $(seq 50); do [ -f /tmp/ngn-forwarding ] && break; sleep 0.1; done',
      '[ -f /tmp/ngn-forwarding ] || { echo "ngn-test: the port forwarder did not start" >&2; exit 70; }',
    );
  }
  if (display === 'xvfb') {
    lines.push(
      'Xvfb -displayfd 3 -screen 0 1280x800x24 -nolisten tcp 3>"$work/display" >/dev/null 2>&1 &',
      'pids="$pids $!"',
      'for _ in $(seq 100); do [ -s "$work/display" ] && break; sleep 0.1; done',
      '[ -s "$work/display" ] || { echo "ngn-test: Xvfb did not start" >&2; exit 70; }',
      'export DISPLAY=":$(cat "$work/display")" GDK_BACKEND=x11',
      'unset WAYLAND_DISPLAY',
    );
  } else if (display === 'weston') {
    lines.push(
      'export XDG_RUNTIME_DIR="$work/run"',
      'mkdir -m 700 "$XDG_RUNTIME_DIR"',
      // Weston 10 and later name the backend and the renderer; el9's Weston 8 takes the module.
      'if weston --help 2>&1 | grep -q -- --renderer; then headless="--backend=headless --renderer=pixman"; else headless="--backend=headless-backend.so --use-pixman"; fi',
      'weston $headless --socket=ngn-wayland --width=1280 --height=800 >"$work/weston.log" 2>&1 &',
      'pids="$pids $!"',
      'for _ in $(seq 100); do [ -S "$XDG_RUNTIME_DIR/ngn-wayland" ] && break; sleep 0.1; done',
      '[ -S "$XDG_RUNTIME_DIR/ngn-wayland" ] || { echo "ngn-test: weston did not start:" >&2; cat "$work/weston.log" >&2; exit 70; }',
      'export WAYLAND_DISPLAY=ngn-wayland GDK_BACKEND=wayland',
      'unset DISPLAY',
    );
  }
  lines.push(
    '"$@" &',
    'host=$!',
    'trap \'kill -TERM "$host" 2>/dev/null\' TERM INT',
    'wait "$host"',
    'status=$?',
    // A trapped signal ends the first wait early: wait again for the host itself.
    'while kill -0 "$host" 2>/dev/null; do wait "$host"; status=$?; done',
    'exit "$status"',
  );
  return lines.join('\n');
}

/** Forwards 127.0.0.1:<port> to host.docker.internal:<port> for each port in argv. */
const FORWARDER = `
const net = require('node:net');
const fs = require('node:fs');
const ports = process.argv.slice(1).map(Number);
let listening = 0;
for (const port of ports) {
  net.createServer((socket) => {
    const upstream = net.connect(port, 'host.docker.internal');
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  }).listen(port, '127.0.0.1', () => {
    if (++listening === ports.length) fs.writeFileSync('/tmp/ngn-forwarding', '');
  });
}
`;

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Environment variables, as `process.env` holds them. */
type Environment = Readonly<Record<string, string | undefined>>;

/** A launch's command, its arguments and environment, and the container it runs in, if any. */
export interface LinuxLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  container?: string;
}

/** The host, the bundle and where they run, from the options and the environment. */
function resolveLaunch(options: LinuxLauncherOptions, env: Environment) {
  const given = options.host ?? env['NGN_DESKTOP_HOST'];
  if (!given) {
    throw new Error(
      "linuxLauncher() needs the Linux desktop host: pass `host` (the build folder's " +
        'gtk/ngn-linux) or set NGN_DESKTOP_HOST.',
    );
  }
  const metroPort = options.metroPort ?? Number(env['RCT_METRO_PORT'] ?? 8081);
  const bundle = options.bundle ?? linuxBundleUrl(metroPort);
  const image = options.container ?? (process.platform === 'linux' ? false : 'ngn-el9');
  return {
    host: path.resolve(given),
    metroPort,
    bundle,
    image,
    display: displayOf(options, image, env),
  };
}

/** The display asked for, or the one in use where there is one and no container. */
function displayOf(
  options: LinuxLauncherOptions,
  image: string | false,
  env: Environment,
): LinuxDisplay {
  const inherited = !image && Boolean(env['DISPLAY'] || env['WAYLAND_DISPLAY']);
  const display = options.display ?? (inherited ? 'inherit' : 'weston');
  if (display === 'inherit' && image) {
    throw new Error('linuxLauncher(): a container has no display to inherit; use xvfb or weston.');
  }
  return display;
}

/** The command a launch runs, with its arguments and environment. */
export function linuxLaunchCommand(
  options: LinuxLauncherOptions,
  request: LaunchRequest,
  env: Environment = process.env,
): LinuxLaunch {
  const resolved = resolveLaunch(options, env);
  const { host, metroPort, image, display } = resolved;
  // A bundle file is resolved against the directory the launch runs in, so the container's mount
  // and the path the host is given name the same file. A URL is left as it is.
  const bundle =
    image && !/^https?:/.test(resolved.bundle)
      ? path.resolve(options.cwd ?? process.cwd(), resolved.bundle)
      : resolved.bundle;
  const hostArgs = [
    host,
    ...(options.args ?? []),
    bundle,
    '--app-id',
    testApplicationId(request.runId),
  ];
  if (!image) {
    return {
      command: 'bash',
      args: ['-c', sessionScript(display), 'ngn-test', ...hostArgs],
      env: {
        ...stringEnv(env),
        ...options.env,
        ...testEnvironment(request),
        ...linuxStateEnvironment(request.stateDir),
      },
    };
  }
  // In the container the state lives in the container, which is removed with the host: the pool's
  // own directory is on the Mac, where the container cannot write.
  const stateDir = '/tmp/ngn-state';
  const containerEnv = {
    ...options.env,
    ...testEnvironment({ ...request, stateDir }),
    ...linuxStateEnvironment(stateDir),
    HOME: '/tmp',
  };
  // The host's build folder, and a bundle file's folder, at the same paths.
  const mounts = [path.dirname(path.dirname(host))];
  if (!/^https?:/.test(bundle)) mounts.push(path.dirname(bundle));
  const name = `ngn-test-${request.runId}`;
  return {
    command: options.docker ?? 'docker',
    container: name,
    args: [
      'run',
      '--rm',
      '--init',
      '--name',
      name,
      ...userArgs(),
      ...mounts.flatMap((mount) => ['-v', `${mount}:${mount}:ro`]),
      ...Object.entries(containerEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      image,
      'bash',
      '-c',
      sessionScript(display, [request.port, metroPort]),
      'ngn-test',
      ...hostArgs,
    ],
    env: stringEnv(env),
  };
}

/** The container runs as this user, so what it writes to a mount is the user's. */
function userArgs(): string[] {
  return process.getuid && process.getgid
    ? ['--user', `${process.getuid()}:${process.getgid()}`]
    : [];
}

function stringEnv(env: Environment): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** The name of signal `number`, as Node names one that ended a process, or undefined. */
function signalName(number: number): string | undefined {
  return Object.entries(constants.signals).find(([, value]) => value === number)?.[0];
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // The group is already gone.
  }
}

/** Whether any process of the group `group` is left. */
function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
}

async function untilGroupGone(group: number): Promise<void> {
  while (groupAlive(group)) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** How many lines of the host's output a lost host's failure quotes. */
const TAIL_LINES = 30;

export function linuxLauncher(options: LinuxLauncherOptions = {}): AppLauncher {
  let tail: string[] = [];
  return {
    start(request): LaunchedApp {
      const launch = linuxLaunchCommand(options, request);
      tail = [];
      const child: ChildProcess = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        env: launch.env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        // The session script leads a process group of its own, so `stop` can end the host and the
        // display with it even when the script's own cleanup cannot run.
        detached: true,
      });
      const keep = (chunk: Buffer) => {
        tail = [...tail, ...chunk.toString().split('\n').filter(Boolean)].slice(-TAIL_LINES);
      };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      const exited = new Promise<string>((resolve) => {
        child.once('error', (error) => resolve(`it could not be started: ${error.message}`));
        child.once('exit', (code, signal) => {
          if (signal) resolve(`signal ${signal}`);
          // The session script exits with 128 plus the signal that ended the host.
          else if (code !== null && signalName(code - 128))
            resolve(`signal ${signalName(code - 128)}`);
          else resolve(`status ${code ?? 'unknown'}`);
        });
      });
      return {
        exited,
        async stop() {
          const group = child.pid;
          if (group !== undefined && groupAlive(group)) {
            signalGroup(group, 'SIGTERM');
            await Promise.race([
              untilGroupGone(group),
              new Promise((resolve) => setTimeout(resolve, options.stopGraceMs ?? 3000)),
            ]);
            if (groupAlive(group)) {
              signalGroup(group, 'SIGKILL');
              await untilGroupGone(group);
            }
          }
          if (launch.container) {
            spawnSync(options.docker ?? 'docker', ['rm', '-f', launch.container], {
              stdio: 'ignore',
            });
          }
          rmSync(request.stateDir, { recursive: true, force: true });
        },
      };
    },
    crashReport() {
      return tail.length ? `The host's last output:\n${tail.join('\n')}` : undefined;
    },
  };
}
