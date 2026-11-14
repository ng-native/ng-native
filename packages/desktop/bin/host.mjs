/**
 * What the `ng-native-desktop` commands share: the app's checked config, the native code its build
 * links, and the desktop host built in the per-user cache (see `cacheDir`) from the pinned sources
 * `native/scripts/fetch.sh` fetches, against the app's own `react-native`. The side effects go
 * through `system`, which the tests replace.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopAppConfig } from './app-config.mjs';
import { desktopLinks, linkWarnings } from './autolink.mjs';
import { choosePrebuilt, fetchPrebuilt, readManifest } from './prebuilt.mjs';

export const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

export class UsageError extends Error {}

/**
 * The libraries whose Fabric components the host compiles in when the app has them installed:
 * the stack, its header and the safe area that `@ng-native/router` and `<safe-area-view>` commit,
 * and the svg views `@ng-native/icons` commits.
 * They ship no desktop code of their own, so autolinking (`autolink.mjs`) does not find them.
 */
export const HOST_LIBRARIES = [
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
];

/**
 * The real side effects, replaced in tests.
 */
export const system = {
  platform: process.platform,
  env: /** @type {Record<string, string | undefined>} */ (process.env),
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
   * @param {{ capture?: boolean, env?: Record<string, string> }} [options] `env` is added to
   *   this process's environment
   */
  run(command, args, { capture = false, env } = {}) {
    const result = spawnSync(command, args, {
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
      ...(env && { env: { ...process.env, ...env } }),
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
  /**
   * Runs the app's own Expo CLI in its directory, with the terminal attached.
   *
   * @param {string} from
   * @param {string[]} args
   */
  expo(from, args) {
    const require = createRequire(path.join(from, 'package.json'));
    const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), ...args], {
      cwd: from,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1 };
  },
  links: desktopLinks,
  /** @param {string} file */
  exists: (file) => existsSync(file),
  /** @param {string} file */
  remove(file) {
    rmSync(file, { recursive: true, force: true });
  },
  /**
   * Copies a file or a folder, links and all, making the folders it goes in.
   *
   * @param {string} from
   * @param {string} to
   */
  copy(from, to) {
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  },
  /** @param {string} file */
  readFile: (file) => readFileSync(file, 'utf8'),
  /** @param {string} file the file's SHA-256, in hex */
  sha256: (file) => createHash('sha256').update(readFileSync(file)).digest('hex'),
  /**
   * @param {string} from
   * @param {string} to
   */
  rename(from, to) {
    renameSync(from, to);
  },
  /**
   * @param {string} file
   * @param {string} text
   */
  writeFile(file, text) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  },
  /** @param {string} line */
  warn(line) {
    console.warn(line);
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
 * Where the native code the app's build links is written for the host build, which reads it from
 * `NGN_DESKTOP_LINK`. In the app's `.expo`, which every template ignores.
 *
 * @param {string} appDir
 */
export function linkFile(appDir) {
  return path.join(appDir, '.expo', 'ng-native-desktop', 'link.json');
}

/**
 * Everything a command needs before it uses the host: the app's checked config, its links written
 * for the build, a warning for each dependency the build leaves without its native code, and the
 * host built (a no-op when nothing changed).
 *
 * @param {typeof system} sys
 * @param {{ universal: boolean, release?: boolean }} options `release` builds the host as a
 *   packaged app ships it, without the core tests
 */
export function prepareHost(sys, options) {
  if (sys.platform !== 'darwin') {
    throw new UsageError('The desktop host runs on macOS only for now.');
  }
  const cwd = sys.cwd();
  const reactNative = resolveReactNative(sys, cwd);
  const expo = readExpoConfig(sys, cwd);
  const config = desktopAppConfig(expo);
  if (/[/\\]/.test(config.name) || config.name === '.' || config.name === '..') {
    throw new UsageError(
      `The app name "${config.name}" cannot contain a path separator or be . or .., because the ` +
        'app, its executable and its packages are named for it. Change "name" in app.json.',
    );
  }
  const deny = config.options.deny ?? [];
  const links = sys.links(cwd, { deny, builtIn: HOST_LIBRARIES });
  for (const line of linkWarnings(links)) sys.warn(line);
  // Written every time, so a library removed or denied leaves the build with the rest.
  const file = linkFile(cwd);
  const { libraries, appModules } = links;
  sys.writeFile(file, `${JSON.stringify({ version: 1, libraries, appModules }, null, 2)}\n`);
  const hostLibraries = HOST_LIBRARIES.filter((name) => !deny.includes(name))
    .map((name) => sys.resolvePackage(cwd, name))
    .filter((dir) => dir !== null);
  const buildDir =
    prebuiltHost(sys, reactNative, { deny, linked: libraries.length + appModules.length }) ??
    buildHost(sys, reactNative, hostLibraries, options, file);
  return { cwd, expo, config, buildDir, reactNative };
}

/**
 * A package's version, from its folder, or null when it has none.
 *
 * @param {typeof system} sys
 * @param {string | null} dir
 */
function versionIn(sys, dir) {
  if (!dir) return null;
  try {
    return String(JSON.parse(sys.readFile(path.join(dir, 'package.json'))).version);
  } catch {
    return null;
  }
}

/**
 * The prebuilt host's build folder when `prebuilt.json` has one this app can run on (see
 * `choosePrebuilt`), downloaded into the cache once; null when the host is built from source.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {{ deny: readonly string[], linked: number }} app
 */
function prebuiltHost(sys, reactNative, { deny, linked }) {
  let text = '';
  try {
    text = sys.readFile(path.join(packageDir, 'prebuilt.json'));
  } catch {
    return null;
  }
  const version = versionIn(sys, reactNative);
  if (!version) return null;
  const cwd = sys.cwd();
  const libraries = Object.fromEntries(
    HOST_LIBRARIES.map((name) => [name, versionIn(sys, sys.resolvePackage(cwd, name))]),
  );
  const choice = choosePrebuilt(readManifest(text), {
    reactNative: version,
    linked,
    libraries,
    deny,
    env: sys.env,
  });
  if (!('host' in choice)) return null;
  return fetchPrebuilt(
    sys,
    choice.host,
    cacheDir(version, { env: sys.env, platform: sys.platform }),
  );
}

/**
 * Builds the host (a no-op when nothing changed) and returns its build directory.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {string[]} libraries
 * @param {{ universal: boolean, release?: boolean }} options
 * @param {string} link the file `linkFile` names
 */
function buildHost(sys, reactNative, libraries, { universal, release }, link) {
  const buildArgs = [reactNative, ...libraries.flatMap((dir) => ['--library', dir])];
  if (universal) buildArgs.push('--universal');
  if (release) buildArgs.push('--release');
  const build = sys.run(path.join(packageDir, 'native', 'scripts', 'build.sh'), buildArgs, {
    capture: true,
    env: { NGN_DESKTOP_LINK: link },
  });
  const buildDir = build.stdout.trim().split('\n').pop();
  if (build.status !== 0 || !buildDir) {
    throw new Error('The desktop host did not build; the output above says why.');
  }
  return buildDir;
}
