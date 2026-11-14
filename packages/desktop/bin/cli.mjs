/**
 * The `ng-native-desktop` command: builds the desktop host when it needs building and launches it,
 * or packages the app (`package.mjs`).
 *
 *     ng-native-desktop run [bundle path or URL] [--module <name>] [--port <port>] [--universal]
 *     ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url>]
 *
 * The host is built in the per-user cache (see `cacheDir`) from the pinned sources
 * `native/scripts/fetch.sh` fetches, against the app's own `react-native`. With no bundle it loads
 * the app from the dev server `npm start` runs, by URL, so reload and Fast Refresh work. The app's
 * Expo config must list `macos`; the command says how to add it when it does not.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { prepareHost, system, UsageError } from './host.mjs';
import { PACKAGE_USAGE, packageApp, parsePackage } from './package.mjs';

export {
  cacheDir,
  checkExpoConfig,
  HOST_LIBRARIES,
  linkFile,
  system,
  UsageError,
} from './host.mjs';

export const USAGE = `Usage: ng-native-desktop run [bundle path or URL] [--module <name>] [--port <port>] [--universal]

Builds the macOS desktop host if it needs building, then opens the app in it: from the dev server
(start it with npm start) unless a bundle path or URL is given.

  --module <name>   the registered app to start (default: main)
  --port <port>     the dev server's port (default: 8081)
  --universal       build for arm64 and x86_64 (default: this Mac's architecture)

${PACKAGE_USAGE}`;

/**
 * The dev server URL of an app's bundle for macOS. The entry is the one Expo's own clients load,
 * which resolves the app's `main` (`/index.bundle` would need an index file at the root).
 *
 * @param {number} port
 */
export function devServerBundleUrl(port) {
  return `http://localhost:${port}/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true`;
}

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {{ command: 'help' } | { command: 'run', bundle: string | undefined, module: string, port: number, universal: boolean } | import('./package.mjs').PackageCommand}
 */
export function parseCommand(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (command === 'package') return parsePackage(rest);
  if (command !== 'run') {
    throw new UsageError(`Unknown command "${command}".`);
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      module: { type: 'string', default: 'main' },
      port: { type: 'string', default: '8081' },
      universal: { type: 'boolean', default: false },
    },
  });
  if (positionals.length > 1) {
    throw new UsageError('run takes at most one bundle path or URL.');
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UsageError(`--port takes a port number, not "${values.port}".`);
  }
  return {
    command: 'run',
    bundle: positionals[0],
    module: values.module,
    port,
    universal: values.universal,
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
 * @param {{ bundle?: string, module: string, port?: number, universal: boolean }} options
 * @param {typeof system} [sys]
 */
export async function run(options, sys = system) {
  const { cwd, expo, config, buildDir } = prepareHost(sys, options);
  const appId = config.bundleIdentifier ?? expo.slug ?? config.name;
  return sys.run(path.join(buildDir, 'appkit', 'ngn-macos'), [
    bundleArgument(options, cwd),
    '--module',
    options.module,
    '--title',
    config.name,
    '--app-id',
    appId,
  ]).status;
}

/**
 * What the host loads. A URL goes to the host as it is: it loads it from the dev server and stays
 * connected for reload and Fast Refresh.
 *
 * @param {{ bundle?: string, port?: number }} options
 * @param {string} cwd
 */
function bundleArgument(options, cwd) {
  if (!options.bundle) return devServerBundleUrl(options.port ?? 8081);
  return isUrl(options.bundle) ? options.bundle : path.resolve(cwd, options.bundle);
}

/**
 * @param {string[]} argv
 * @param {typeof system} [sys]
 */
export async function main(argv, sys = system) {
  try {
    const command = parseCommand(argv);
    if (command.command === 'help') {
      console.log(USAGE);
      return 0;
    }
    if (command.command === 'package') return await packageApp(command, sys);
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
