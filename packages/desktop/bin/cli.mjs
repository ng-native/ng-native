/**
 * The `ng-native-desktop` command: builds the desktop host when it needs building and launches it.
 *
 *     ng-native-desktop run [bundle path or URL] [--module <name>] [--port <port>] [--universal]
 *
 * The host is built in the per-user cache (see `cacheDir`) from the pinned sources
 * `native/scripts/fetch.sh` fetches, against the app's own `react-native`. With no bundle it loads
 * the app from the dev server `npm start` runs, by URL, so reload and Fast Refresh work. The app's
 * Expo config must list `macos`; the command says how to add it when it does not.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { desktopAppConfig } from './app-config.mjs';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const USAGE = `Usage: ng-native-desktop run [bundle path or URL] [--module <name>] [--port <port>] [--universal]

Builds the macOS desktop host if it needs building, then opens the app in it: from the dev server
(start it with npm start) unless a bundle path or URL is given.

  --module <name>   the registered app to start (default: main)
  --port <port>     the dev server's port (default: 8081)
  --universal       build for arm64 and x86_64 (default: this Mac's architecture)`;

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
 * The per-user build cache for one React Native version. `native/scripts/cache-dir.sh` computes
 * the same path for the build scripts.
 *
 * @param {string} version
 * @param {{ env?: Record<string, string | undefined>, platform?: string, home?: string }} [options]
 */
export function cacheDir(
  version,
  { env = process.env, platform = process.platform, home = homedir() } = {},
) {
  let root = env.NGN_DESKTOP_CACHE;
  if (!root) {
    root =
      platform === 'darwin'
        ? path.join(home, 'Library', 'Caches', 'ng-native', 'desktop')
        : path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ng-native', 'desktop');
  }
  return path.join(root, `rn-${version}`);
}

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {{ command: 'help' } | { command: 'run', bundle: string | undefined, module: string, port: number, universal: boolean }}
 */
export function parseCommand(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
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

export class UsageError extends Error {}

/** @param {string} bundle */
export function isUrl(bundle) {
  return /^https?:\/\//i.test(bundle);
}

/**
 * The libraries whose Fabric components the host compiles in when the app has them installed:
 * the stack, its header and the safe area that `@ng-native/router` and `<safe-area-view>` commit.
 * Expo autolinking for `macos` replaces this list.
 */
export const HOST_LIBRARIES = ['react-native-screens', 'react-native-safe-area-context'];

/**
 * The real side effects, replaced in tests.
 */
export const system = {
  platform: process.platform,
  cwd: () => process.cwd(),
  /** @param {string} from */
  resolveReactNative(from) {
    const require = createRequire(path.join(from, 'package.json'));
    return path.dirname(require.resolve('react-native/package.json'));
  },
  /**
   * An installed package's directory, or null when the app does not have it.
   *
   * @param {string} from
   * @param {string} name
   * @returns {string | null}
   */
  resolvePackage(from, name) {
    const require = createRequire(path.join(from, 'package.json'));
    try {
      return path.dirname(require.resolve(`${name}/package.json`));
    } catch {
      return null;
    }
  },
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {{ capture?: boolean }} [options]
   */
  run(command, args, { capture = false } = {}) {
    const result = spawnSync(command, args, {
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
  },
  /**
   * The project's public Expo config, as the Expo CLI resolves it (app.json or app.config.js).
   *
   * @param {string} from
   * @returns {ExpoConfig}
   */
  expoConfig(from) {
    const require = createRequire(path.join(from, 'package.json'));
    const result = spawnSync(
      process.execPath,
      [require.resolve('expo/bin/cli'), 'config', '--json', '--type', 'public'],
      { cwd: from, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('The Expo CLI could not read the app config.');
    return JSON.parse(result.stdout);
  },
};

/** @typedef {import('./app-config.mjs').ExpoConfig} ExpoConfig */

/**
 * Throws a usage error naming the fix when the app's Expo config cannot run on macOS: without
 * `macos` in `expo.platforms`, Metro does not bundle for it, and without the experiment Expo drops
 * `macos` from the list without a word.
 *
 * @param {ExpoConfig} config
 */
export function checkExpoConfig(config) {
  if (!config.platforms?.includes('macos')) {
    throw new UsageError(
      'The app\'s Expo config does not list macos. Add "macos" to expo.platforms in app.json and set expo.experiments.outOfTreePlatforms to true.',
    );
  }
  if (!config.experiments?.outOfTreePlatforms) {
    throw new UsageError(
      "The app's Expo config lists macos without expo.experiments.outOfTreePlatforms, so Expo ignores it. Set expo.experiments.outOfTreePlatforms to true in app.json.",
    );
  }
}

/**
 * Builds the host (a no-op when nothing changed) and runs it on the bundle. Returns the host's
 * exit status.
 *
 * @param {{ bundle?: string, module: string, port?: number, universal: boolean }} options
 * @param {typeof system} [sys]
 */
export async function run(options, sys = system) {
  if (sys.platform !== 'darwin') {
    throw new UsageError('The desktop host runs on macOS only for now.');
  }
  const cwd = sys.cwd();
  const reactNative = resolveReactNative(sys, cwd);
  const expo = readExpoConfig(sys, cwd);
  const config = desktopAppConfig(expo);
  const libraries = HOST_LIBRARIES.map((name) => sys.resolvePackage(cwd, name)).filter(
    (dir) => dir !== null,
  );
  const buildDir = buildHost(sys, reactNative, libraries, options.universal);
  const title = config.name;
  const appId = config.bundleIdentifier ?? expo.slug ?? title;
  return sys.run(path.join(buildDir, 'appkit', 'ngn-macos'), [
    bundleArgument(options, cwd),
    '--module',
    options.module,
    '--title',
    title,
    '--app-id',
    appId,
  ]).status;
}

/**
 * @param {typeof system} sys
 * @param {string} cwd
 */
function resolveReactNative(sys, cwd) {
  try {
    return sys.resolveReactNative(cwd);
  } catch {
    throw new UsageError(
      `react-native is not installed in ${cwd}. Run this from the app's directory.`,
    );
  }
}

/**
 * The app's Expo config, checked for macos.
 *
 * @param {typeof system} sys
 * @param {string} cwd
 */
function readExpoConfig(sys, cwd) {
  /** @type {ExpoConfig} */
  let config;
  try {
    config = sys.expoConfig(cwd);
  } catch (error) {
    throw new UsageError(
      `Could not read the app's Expo config in ${cwd}: ${error instanceof Error ? error.message : error}`,
    );
  }
  checkExpoConfig(config);
  return config;
}

/**
 * Builds the host (a no-op when nothing changed) and returns its build directory.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {string[]} libraries
 * @param {boolean} universal
 */
function buildHost(sys, reactNative, libraries, universal) {
  const buildArgs = [reactNative, ...libraries.flatMap((dir) => ['--library', dir])];
  if (universal) buildArgs.push('--universal');
  const build = sys.run(path.join(packageDir, 'native', 'scripts', 'build.sh'), buildArgs, {
    capture: true,
  });
  const buildDir = build.stdout.trim().split('\n').pop();
  if (build.status !== 0 || !buildDir) {
    throw new Error('The desktop host did not build; the output above says why.');
  }
  return buildDir;
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
