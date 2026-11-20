/**
 * The `ng-native-desktop` command: builds the desktop host when it needs building and launches it,
 * or packages the app (`package.mjs`).
 *
 *     ng-native-desktop run [bundle path or URL] [--os macos|linux] [--module <name>] [--port <port>] [--url <link>] [--universal]
 *     ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url>]
 *
 * The host is the prebuilt one when one fits the app, or is built in the per-user cache (see
 * `cacheDir`) from the pinned sources `native/scripts/fetch.sh` fetches, against the app's own
 * `react-native`: the AppKit host on a Mac, the GTK host on Linux. With no bundle it loads the app
 * from the dev server `npm start` runs, by URL, so reload and Fast Refresh work. The app's Expo
 * config must list the OS; the command says how to add it when it does not.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { hostCapabilities } from './app-config.mjs';
import { prepareHost, system, UsageError } from './host.mjs';
import { linuxRunAppId } from './package-linux.mjs';
import { PACKAGE_USAGE, packageApp, parsePackage } from './package.mjs';

export {
  cacheDir,
  checkExpoConfig,
  HOST_LIBRARIES,
  linkFile,
  system,
  UsageError,
} from './host.mjs';

export const USAGE = `Usage: ng-native-desktop run [bundle path or URL] [--os macos|linux] [--module <name>] [--port <port>]
                          [--url <link>] [--universal]

Builds the desktop host if it needs building, then opens the app in it: from the dev server (start
it with npm start) unless a bundle path or URL is given. The macOS host runs on a Mac, the Linux
(GTK) host on Linux.

  --os <os>         the OS to run on: macos or linux (default: this machine's)
  --module <name>   the registered app to start (default: main)
  --port <port>     the dev server's port (default: 8081)
  --url <link>      a link to open the app on, as Linking's initial URL (myapp://settings)
  --universal       with --os macos, build for arm64 and x86_64 (default: this Mac's architecture)

Usage: ng-native-desktop host [--os macos|linux]

Gets the debug host run uses, as run gets it, and prints its executable's path. A Linux host comes
prebuilt on any machine, and builds only on Linux. The in-app test pool's Linux launcher runs it.

${PACKAGE_USAGE}`;

/**
 * @typedef {import('./autolink.mjs').DesktopOs} DesktopOs
 * @typedef {{ command: 'run', os: DesktopOs, bundle: string | undefined, module: string, port: number, universal: boolean, url?: string }} RunCommand
 * @typedef {{ command: 'host', os: DesktopOs }} HostCommand
 */

/**
 * The dev server URL of an app's bundle for a desktop OS. The entry is the one Expo's own clients
 * load, which resolves the app's `main` (`/index.bundle` would need an index file at the root).
 *
 * @param {number} port
 * @param {DesktopOs} [os]
 */
export function devServerBundleUrl(port, os = 'macos') {
  return `http://localhost:${port}/.expo/.virtual-metro-entry.bundle?platform=${os}&dev=true`;
}

/**
 * @param {string[]} argv the arguments after the command name
 * @param {string} [platform] this machine's, which `run --os` and `package --os` default to
 * @returns {{ command: 'help' } | RunCommand | HostCommand | import('./package.mjs').PackageCommand}
 */
export function parseCommand(argv, platform = process.platform) {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (command === 'package') return parsePackage(rest, platform);
  if (command === 'host') return parseHost(rest, platform);
  if (command !== 'run') {
    throw new UsageError(`Unknown command "${command}".`);
  }
  return parseRun(rest, platform);
}

/**
 * @param {string[]} args the arguments after `host`
 * @param {string} platform
 * @returns {HostCommand}
 */
function parseHost(args, platform) {
  const { values } = parseArgs({ args, options: { os: { type: 'string' } } });
  return { command: 'host', os: parseOs(values.os, platform) };
}

/**
 * The OS `--os` names, this machine's when it names none.
 *
 * @param {string | undefined} value
 * @param {string} platform
 * @returns {DesktopOs}
 */
function parseOs(value, platform) {
  const os = value ?? (platform === 'linux' ? 'linux' : 'macos');
  if (os !== 'macos' && os !== 'linux') {
    throw new UsageError(`--os takes macos or linux, not "${os}".`);
  }
  return os;
}

/**
 * Gets the debug host `run` uses for `os`, as `run` gets it, and returns its executable. Unlike
 * `run`, it takes a prebuilt Linux host off Linux, where a container runs it.
 *
 * @param {{ os: DesktopOs }} options
 * @param {typeof system} [sys]
 */
export function hostExecutable({ os }, sys = system) {
  const { buildDir } = prepareHost(sys, { os, universal: false });
  return executableIn(buildDir, os);
}

/**
 * @param {string} buildDir
 * @param {DesktopOs} os
 */
function executableIn(buildDir, os) {
  return os === 'linux'
    ? path.join(buildDir, 'gtk', 'ngn-linux')
    : path.join(buildDir, 'appkit', 'ngn-macos');
}

/**
 * @param {string[]} args the arguments after `run`
 * @param {string} platform
 * @returns {RunCommand}
 */
function parseRun(args, platform) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      os: { type: 'string' },
      module: { type: 'string', default: 'main' },
      port: { type: 'string', default: '8081' },
      universal: { type: 'boolean', default: false },
      url: { type: 'string' },
    },
  });
  if (positionals.length > 1) {
    throw new UsageError('run takes at most one bundle path or URL.');
  }
  const os = parseOs(values.os, platform);
  if (os === 'linux' && values.universal) {
    throw new UsageError(
      '--universal is for --os macos only: a Linux host is built for this machine.',
    );
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UsageError(`--port takes a port number, not "${values.port}".`);
  }
  return {
    command: 'run',
    os,
    bundle: positionals[0],
    module: values.module,
    port,
    universal: values.universal,
    ...(values.url !== undefined && { url: values.url }),
  };
}

/** @param {string} bundle */
export function isUrl(bundle) {
  return /^https?:\/\//i.test(bundle);
}

/**
 * Builds the host (a no-op when nothing changed) and runs it on the bundle. Returns the host's
 * exit status.
 *
 * @param {{ os?: DesktopOs, bundle?: string, module: string, port?: number, universal: boolean, url?: string }} options
 *   `os` is macos unless it says
 * @param {typeof system} [sys]
 */
export async function run(options, sys = system) {
  const os = options.os ?? 'macos';
  if (os === 'linux' && sys.platform !== 'linux') {
    // Before the host is fetched or built: it would have no display to draw on here.
    throw new UsageError(
      'The Linux desktop host runs on Linux only for now. Run npm run linux on a Linux machine ' +
        'or VM; from this machine, npm run package -- --os linux makes the Linux packages.',
    );
  }
  const { cwd, expo, config, buildDir } = prepareHost(sys, { ...options, os });
  const appId =
    os === 'linux'
      ? linuxRunAppId(expo, config)
      : (config.bundleIdentifier ?? expo.slug ?? config.name);
  // What Processes may run and read, as a packaged app's Info.plist or embedded metadata gives it.
  const capabilities = hostCapabilities(config.options);
  return sys.host(executableIn(buildDir, os), [
    bundleArgument(options, os, cwd),
    '--module',
    options.module,
    '--title',
    config.name,
    '--app-id',
    appId,
    ...(capabilities ? ['--capabilities', JSON.stringify(capabilities)] : []),
    ...(options.url ? ['--url', options.url] : []),
  ]);
}

/**
 * What the host loads. A URL goes to the host as it is: it loads it from the dev server and stays
 * connected for reload and Fast Refresh.
 *
 * @param {{ bundle?: string, port?: number }} options
 * @param {DesktopOs} os
 * @param {string} cwd
 */
function bundleArgument(options, os, cwd) {
  if (!options.bundle) return devServerBundleUrl(options.port ?? 8081, os);
  return isUrl(options.bundle) ? options.bundle : path.resolve(cwd, options.bundle);
}

/**
 * @param {string[]} argv
 * @param {typeof system} [sys]
 */
export async function main(argv, sys = system) {
  try {
    const command = parseCommand(argv, sys.platform);
    if (command.command === 'help') {
      console.log(USAGE);
      return 0;
    }
    if (command.command === 'package') return await packageApp(command, sys);
    if (command.command === 'host') {
      // Alone on stdout, which the launcher reads: the build's own output goes to stderr.
      console.log(hostExecutable(command, sys));
      return 0;
    }
    return await run(command, sys);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
    ) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}
