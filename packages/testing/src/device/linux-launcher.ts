/**
 * The launcher for the Linux desktop host (`ngn-linux`, the GTK host): the host started on the dev
 * server's Linux bundle with the test environment the host's contract names (see `launcher.ts`),
 * on a display of its own where asked. On Linux it runs the host directly; on a Mac it runs it in
 * the AlmaLinux 9 image the host is built in (`packages/desktop/native/docker`), which reaches the
 * pool and Metro on the Mac through ports it forwards.
 *
 * The launch has a fake system UI (`fake-portals.py`, in the package's `device` folder): a private
 * session bus where the fake owns `org.freedesktop.portal.Desktop`, so a file chooser, a link or a
 * notification asks nobody and a test can see the call and answer it, as the macOS host's fake
 * system UI answers as a person cancelling would. Its control folder is `portals` in the launch's
 * state folder, described in the script's header. `fakeSystemUi: false` leaves the session's own
 * bus and portals in use.
 *
 * Linux has no crash report location of its own, so the host writes `crash.txt` in its state
 * folder as it dies of a fatal signal. The session script prints it after the host, where the
 * launch's output carries it out of a container too, and the pool names it for a lost host, with
 * the end of the host's output.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
   * The image to run the host in, or `false` to run it directly. Default: `NGN_LINUX_IMAGE`, or
   * `ngn-el9`, on any OS but Linux, and none on Linux.
   */
  container?: string | false;
  /** The container command. Default `docker`. */
  docker?: string;
  /**
   * The directory the host runs in, and the base a relative `bundle` file is resolved against, in a
   * container too. Default: the current directory.
   */
  cwd?: string;
  /**
   * Whether the host runs against a fake system UI: its own session bus with a fake desktop portal
   * on it (`fake-portals.py`), which answers a file chooser as cancelled and a link as opened,
   * records every call and takes a test's answers, instead of the session's portals, which would
   * open a real dialog. It needs `dbus-daemon` and `python3` with PyGObject where the host runs,
   * and the launch fails without them. Default true.
   */
  fakeSystemUi?: boolean;
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
export function sessionScript(
  display: LinuxDisplay,
  forward: readonly number[] = [],
  fakeSystemUi = false,
): string {
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
  if (fakeSystemUi) lines.push(...FAKE_SYSTEM_UI);
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
    // The host's crash report, which a container's state goes with.
    `if [ -s "$NGN_STATE_DIR/crash.txt" ]; then echo ${shellQuote(CRASH_MARKER)} >&2; cat "$NGN_STATE_DIR/crash.txt" >&2; fi`,
    'exit "$status"',
  );
  return lines.join('\n');
}

/**
 * The fake system UI's lines of the session script: a session bus of the launch's own, with no
 * service files, so nothing is started on demand, and the fake desktop portal on it
 * (`$NGN_FAKE_PORTALS`), answering before the host starts. The bus has its own configuration, which
 * lets any client own a name.
 */
const FAKE_SYSTEM_UI = [
  'command -v dbus-daemon >/dev/null && command -v python3 >/dev/null && python3 -c "import gi" 2>/dev/null || { echo "ngn-test: the fake system UI needs dbus-daemon and python3 with PyGObject (launcher option fakeSystemUi: false runs without it)" >&2; exit 70; }',
  `cat >"$work/bus.conf" <<EOF
<busconfig><type>session</type><listen>unix:path=$work/bus</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>
EOF`,
  'dbus-daemon --config-file="$work/bus.conf" --nofork >"$work/bus.log" 2>&1 &',
  'pids="$pids $!"',
  'for _ in $(seq 100); do [ -S "$work/bus" ] && break; sleep 0.1; done',
  '[ -S "$work/bus" ] || { echo "ngn-test: the session bus did not start:" >&2; cat "$work/bus.log" >&2; exit 70; }',
  'export DBUS_SESSION_BUS_ADDRESS="unix:path=$work/bus"',
  'python3 "$NGN_FAKE_PORTALS" "$NGN_STATE_DIR/portals" >"$work/portals.log" 2>&1 &',
  'pids="$pids $!"',
  'for _ in $(seq 100); do [ -e "$NGN_STATE_DIR/portals/ready" ] && break; sleep 0.1; done',
  '[ -e "$NGN_STATE_DIR/portals/ready" ] || { echo "ngn-test: the fake portals did not start:" >&2; cat "$work/portals.log" >&2; exit 70; }',
];

/**
 * What a container with a fake system UI runs first, as root: the session bus will not take a
 * client whose user the image has no passwd entry for, and the container's user is the caller's
 * (so what it writes to a mount is theirs), so the entry is made, and the session script
 * (`$1`) runs as that user from here.
 */
export const ROOT_PRELUDE = [
  'set -eu',
  'if [ -n "${NGN_AS_USER:-}" ]; then',
  '  uid=${NGN_AS_USER%:*}; gid=${NGN_AS_USER#*:}',
  '  getent group "$gid" >/dev/null || echo "ngn:x:$gid:" >>/etc/group',
  '  getent passwd "$uid" >/dev/null || echo "ngn:x:$uid:$gid::/tmp:/bin/bash" >>/etc/passwd',
  '  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups bash -c "$@"',
  'fi',
  'exec bash -c "$@"',
].join('\n');

/** Where the fake desktop portal's script is, in this package's `device` folder. */
export const FAKE_PORTALS = fileURLToPath(new URL('../../device/fake-portals.py', import.meta.url));

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

/**
 * The image a launch runs in off Linux: `NGN_LINUX_IMAGE`, such as `ngn-fedora` (the newer-GTK
 * variant beside the AlmaLinux 9 one), or `ngn-el9`. An empty value is a mistake, not the default.
 */
export function imageNamed(env: Environment): string {
  const named = env['NGN_LINUX_IMAGE'];
  if (named === undefined) return 'ngn-el9';
  if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/.test(named)) {
    throw new Error(`NGN_LINUX_IMAGE is not an image name: ${JSON.stringify(named)}.`);
  }
  return named;
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
  const image = options.container ?? (process.platform === 'linux' ? false : imageNamed(env));
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

/**
 * The bundle and the host's command line. A bundle file is resolved against the directory the
 * launch runs in, so the container's mount and the path the host is given name the same file. A
 * URL is left as it is.
 */
function hostCommand(
  options: LinuxLauncherOptions,
  request: LaunchRequest,
  resolved: ReturnType<typeof resolveLaunch>,
): { bundle: string; hostArgs: string[] } {
  const { host, image } = resolved;
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
  return { bundle, hostArgs };
}

/** The command a launch runs, with its arguments and environment. */
export function linuxLaunchCommand(
  options: LinuxLauncherOptions,
  request: LaunchRequest,
  env: Environment = process.env,
): LinuxLaunch {
  const resolved = resolveLaunch(options, env);
  const { host, metroPort, image, display } = resolved;
  const { bundle, hostArgs } = hostCommand(options, request, resolved);
  const fakeSystemUi = options.fakeSystemUi ?? true;
  const fake: Record<string, string> = fakeSystemUi ? { NGN_FAKE_PORTALS: FAKE_PORTALS } : {};
  if (!image) {
    return {
      command: 'bash',
      args: ['-c', sessionScript(display, [], fakeSystemUi), 'ngn-test', ...hostArgs],
      env: {
        ...stringEnv(env),
        ...options.env,
        ...testEnvironment(request),
        ...linuxStateEnvironment(request.stateDir),
        ...fake,
      },
    };
  }
  const session = sessionScript(
    display,
    forwardedPorts(request.port, metroPort, bundle),
    fakeSystemUi,
  );
  // The host's build folder, a bundle file's folder, and the fake portals' script's, at the same
  // paths.
  const mounts = [path.dirname(path.dirname(host))];
  if (!/^https?:/.test(bundle)) mounts.push(path.dirname(bundle));
  if (fakeSystemUi) mounts.push(path.dirname(FAKE_PORTALS));
  const user = containerUser(fakeSystemUi);
  // In the container the state lives in the container, which is removed with the host: the pool's
  // own directory is on the Mac, where the container cannot write.
  const stateDir = '/tmp/ngn-state';
  const containerEnv: Record<string, string> = {
    ...options.env,
    ...testEnvironment({ ...request, stateDir }),
    ...linuxStateEnvironment(stateDir),
    ...fake,
    ...user.env,
    HOME: '/tmp',
  };
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
      ...user.flags,
      ...mounts.flatMap((mount) => ['-v', `${mount}:${mount}:ro`]),
      ...Object.entries(containerEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      image,
      'bash',
      '-c',
      ...(fakeSystemUi ? [ROOT_PRELUDE, 'ngn-prelude', session] : [session]),
      'ngn-test',
      ...hostArgs,
    ],
    env: stringEnv(env),
  };
}

/**
 * Who the container runs as. With a fake system UI it starts as root, makes the caller's user
 * known to the image and drops to it (`ROOT_PRELUDE`, told the user as `NGN_AS_USER`); without one
 * it starts as that user, so what it writes to a mount is theirs.
 */
function containerUser(fakeSystemUi: boolean): { flags: string[]; env: Record<string, string> } {
  const user = process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : '';
  if (fakeSystemUi) return { flags: [], env: { NGN_AS_USER: user } };
  return { flags: user ? ['--user', user] : [], env: {} };
}

/**
 * The ports the container forwards to the machine running Vitest: the pool's, Metro's, and a
 * bundle URL's own when it names a loopback port, each once.
 */
function forwardedPorts(poolPort: number, metroPort: number, bundle: string): number[] {
  const ports = [poolPort, metroPort];
  if (/^https?:/.test(bundle)) {
    const url = new URL(bundle);
    if (url.port && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      ports.push(Number(url.port));
    }
  }
  return [...new Set(ports)];
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

/** Whether the group `group` has any process, a zombie included: the kernel's answer, at once. */
function groupExists(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether any process of the group `group` is left. A zombie is not: when the process running
 * Vitest is PID 1 (a container started without `--init`), what the session leaves behind is
 * reparented to it and never reaped, so the group never empties of zombies. Where `/proc` cannot
 * be read, any process counts.
 */
function groupAlive(group: number): boolean {
  if (process.platform === 'linux') {
    const alive = liveGroupMember(group);
    if (alive !== undefined) return alive;
  }
  return groupExists(group);
}

/** Whether `/proc` lists a process of group `group` that is not a zombie, or undefined without `/proc`. */
function liveGroupMember(group: number): boolean | undefined {
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return undefined;
  }
  return pids.some((pid) => {
    let stat: string;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      return false; // Gone since the listing.
    }
    // `pid (comm) state ppid pgrp ...`, where comm may hold spaces and parentheses.
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(pgrp) === group && state !== 'Z';
  });
}

async function untilGroupGone(group: number): Promise<void> {
  while (groupAlive(group)) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** How many lines of the host's output a lost host's failure quotes. */
const TAIL_LINES = 30;

/** The line the session script prints before the host's `crash.txt`. */
export const CRASH_MARKER = 'ngn-test: the host left crash.txt:';

/** How long a crash report waits for the host's last output after it exits, in milliseconds. */
const DRAIN_MS = 1000;

/** What a launch's output has said: its last lines, and the crash report it printed. */
interface Said {
  tail: string[];
  crash: string[] | undefined;
}

/**
 * Take one line of the host's output into `said`. The session script prints the crash report on
 * stderr after its marker, so only stderr's lines from there on are the report; stdout's stay in
 * the tail.
 */
function hear(said: Said, line: string, stderr: boolean): void {
  if (stderr && said.crash) said.crash.push(line);
  else if (stderr && line === CRASH_MARKER) said.crash = [];
  else said.tail = [...said.tail, line].slice(-TAIL_LINES);
}

export function linuxLauncher(options: LinuxLauncherOptions = {}): AppLauncher {
  // The latest launch's output: what it said, each stream's unfinished line, and when its pipes
  // closed.
  let output = {
    said: { tail: [], crash: undefined } as Said,
    pending: [] as string[],
    closed: Promise.resolve(),
  };
  return {
    start(request): LaunchedApp {
      const launch = linuxLaunchCommand(options, request);
      const child: ChildProcess = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        env: launch.env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        // The session script leads a process group of its own, so `stop` can end the host and the
        // display with it even when the script's own cleanup cannot run.
        detached: true,
      });
      // Node can report the exit before the pipes hand over the last output, the crash message
      // among it, so a report waits for them to close.
      const current = {
        said: { tail: [], crash: undefined } as Said,
        pending: ['', ''],
        closed: new Promise<void>((resolve) => child.once('close', () => resolve())),
      };
      output = current;
      // A chunk need not end on a line break, so each stream keeps its unfinished line until the
      // rest arrives, and gives it up at the end of the stream.
      [child.stdout, child.stderr].forEach((stream, at) => {
        stream?.on('data', (chunk: Buffer) => {
          const lines = (current.pending[at] + chunk.toString()).split('\n');
          current.pending[at] = lines.pop() ?? '';
          for (const line of lines) if (line) hear(current.said, line, at === 1);
        });
        stream?.on('end', () => {
          if (current.pending[at]) hear(current.said, current.pending[at], at === 1);
          current.pending[at] = '';
        });
      });
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
          if (group !== undefined && groupExists(group)) {
            signalGroup(group, 'SIGTERM');
            await Promise.race([
              untilGroupGone(group),
              new Promise((resolve) => setTimeout(resolve, options.stopGraceMs ?? 3000)),
            ]);
            // Sent even when the scan found the group gone, since a scan can miss a process forked
            // while it ran. Killing a group is atomic against fork, and the group only shrinks
            // after it, so the wait that follows can trust a scan.
            signalGroup(group, 'SIGKILL');
            await untilGroupGone(group);
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
    async crashReport() {
      // The launch asked about, before a relaunch replaces it. A process the session left holding
      // the pipes open bounds the wait.
      const asked = output;
      await Promise.race([
        asked.closed,
        new Promise((resolve) => setTimeout(resolve, DRAIN_MS).unref()),
      ]);
      // A process still holding the pipes can leave a line unfinished: the report has it too, from
      // a copy, so later output can still finish the line.
      const said: Said = {
        tail: [...asked.said.tail],
        crash: asked.said.crash && [...asked.said.crash],
      };
      asked.pending.forEach((line, at) => line && hear(said, line, at === 1));
      const { tail, crash } = said;
      const parts = [
        ...(crash?.length ? [`The host's crash report:\n${crash.join('\n')}`] : []),
        ...(tail.length ? [`The host's last output:\n${tail.join('\n')}`] : []),
      ];
      return parts.length ? parts.join('\n\n') : undefined;
    },
  };
}
