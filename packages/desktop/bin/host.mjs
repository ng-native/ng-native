/**
 * What the `ng-native-desktop` commands share: the app's checked config, the native code its build
 * links, and the desktop host built in the per-user cache (see `cacheDir`) from the pinned sources
 * `native/scripts/fetch.sh` fetches, against the app's own `react-native`. The side effects go
 * through `system`, which the tests replace.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { constants, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopAppConfig } from './app-config.mjs';
import { desktopLinks, linkWarnings } from './autolink.mjs';
import { choosePrebuilt, fetchPrebuilt, readManifest } from './prebuilt.mjs';
import { checkToolchain, FIRST_BUILD_NOTE, LINUX_FIRST_BUILD_NOTE } from './toolchain.mjs';

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
 * the svg views `@ng-native/icons` commits, the web view `<web-view>` and an `<iframe>` commit, and
 * the worklets and Reanimated, whose shared C++ the host builds by its own recipes
 * (`native/cmake/libraries/`).
 * They ship no desktop code of their own, so autolinking (`autolink.mjs`) does not find them.
 */
export const HOST_LIBRARIES = [
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
  'react-native-webview',
  'react-native-worklets',
  'react-native-reanimated',
];

/**
 * The real side effects, replaced in tests.
 */
export const system = {
  platform: process.platform,
  /** This machine's architecture, as Node names it (`x64`, `arm64`). */
  arch: process.arch,
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
   * @param {{ capture?: boolean, quiet?: boolean, env?: Record<string, string> }} [options] `env`
   *   is added to this process's environment; `quiet` drops the command's stderr, for a probe
   *   whose answer is its status and stdout
   */
  run(command, args, { capture = false, quiet = false, env } = {}) {
    const stderr = quiet ? 'ignore' : 'inherit';
    const result = spawnSync(command, args, {
      stdio: capture ? ['inherit', 'pipe', stderr] : ['inherit', 'inherit', stderr],
      encoding: 'utf8',
      ...(env && { env: { ...process.env, ...env } }),
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
  },
  /**
   * Runs the host with this process's environment and terminal, passing on the signals that end a
   * process (a test pool's SIGTERM, Ctrl-C), and resolves with its status: its exit code, or 128
   * and the signal's number when a signal ended it.
   *
   * @param {string} command
   * @param {string[]} args
   * @returns {Promise<number>}
   */
  host(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'inherit' });
      const signals = /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP']);
      const forward = (/** @type {NodeJS.Signals} */ signal) => child.kill(signal);
      for (const signal of signals) process.on(signal, forward);
      const done = () => {
        for (const signal of signals) process.off(signal, forward);
      };
      child.once('error', (error) => {
        done();
        reject(error);
      });
      child.once('exit', (code, signal) => {
        done();
        resolve(code ?? 128 + (signal ? osSignal(signal) : 0));
      });
    });
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
  /** @param {string} dir */
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  /** @param {string} file */
  readBytes: (file) => new Uint8Array(readFileSync(file)),
  /**
   * Every file and symbolic link under `dir`, by its path from there with `/` between parts, in
   * order: a file with its permissions, a link with what it points to.
   *
   * @param {string} dir
   * @returns {{ path: string, mode: number, link?: string }[]}
   */
  files(dir) {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .sort()
      .flatMap((name) => {
        const file = path.join(dir, name);
        const stat = lstatSync(file);
        const at = name.split(path.sep).join('/');
        if (stat.isSymbolicLink()) return [{ path: at, mode: 0o777, link: readlinkSync(file) }];
        return stat.isFile() ? [{ path: at, mode: stat.mode & 0o7777 }] : [];
      });
  },
  /**
   * Makes `file` a symbolic link to `target`, making the folder it goes in.
   *
   * @param {string} target
   * @param {string} file
   */
  symlink(target, file) {
    mkdirSync(path.dirname(file), { recursive: true });
    rmSync(file, { force: true });
    symlinkSync(target, file);
  },
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
   * @param {string | Uint8Array} text
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

/**
 * @typedef {import('./app-config.mjs').ExpoConfig} ExpoConfig
 */

/**
 * Throws a usage error naming the fix when the app's Expo config cannot run on a desktop OS:
 * without the OS in `expo.platforms`, Metro does not bundle for it, and without the experiment Expo
 * drops it from the list without a word.
 *
 * @param {ExpoConfig} config
 * @param {import('./autolink.mjs').DesktopOs} [os]
 */
export function checkExpoConfig(config, os = 'macos') {
  if (!config.platforms?.includes(os)) {
    throw new UsageError(
      `The app's Expo config does not list ${os}. Add "${os}" to expo.platforms in app.json and set expo.experiments.outOfTreePlatforms to true.`,
    );
  }
  if (!config.experiments?.outOfTreePlatforms) {
    throw new UsageError(
      `The app's Expo config lists ${os} without expo.experiments.outOfTreePlatforms, so Expo ignores it. Set expo.experiments.outOfTreePlatforms to true in app.json.`,
    );
  }
}

/**
 * @param {typeof system} sys
 * @param {string} cwd
 */
export function resolveReactNative(sys, cwd) {
  try {
    return sys.resolveReactNative(cwd);
  } catch {
    throw new UsageError(
      `react-native is not installed in ${cwd}. Run this from the app's directory.`,
    );
  }
}

/**
 * The app's Expo config, checked for a desktop OS.
 *
 * @param {typeof system} sys
 * @param {string} cwd
 * @param {import('./autolink.mjs').DesktopOs} [os]
 */
export function readExpoConfig(sys, cwd, os = 'macos') {
  /** @type {ExpoConfig} */
  let config;
  try {
    config = sys.expoConfig(cwd);
  } catch (error) {
    throw new UsageError(
      `Could not read the app's Expo config in ${cwd}: ${error instanceof Error ? error.message : error}`,
    );
  }
  checkExpoConfig(config, os);
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
 * The macOS host builds on a Mac. A Linux host comes prebuilt for its architecture, or builds on
 * Linux of that architecture.
 *
 * @param {typeof system} sys
 * @param {{ universal: boolean, release?: boolean, expo?: ExpoConfig, os?: import('./autolink.mjs').DesktopOs, arch?: LinuxArch }} options
 *   `os` is the desktop OS the host is for (macos unless said), which picks the native code the app
 *   links (`autolink.mjs`); `arch` a Linux host's architecture, this machine's unless said;
 *   `release` builds the host as a packaged app ships it, without the core tests or the debugger,
 *   and takes the release prebuilt host where one fits (the debug one otherwise); `expo` is the
 *   app's config when the caller has read it already
 */
export function prepareHost(sys, options) {
  const os = options.os ?? 'macos';
  if (os === 'macos' && sys.platform !== 'darwin') {
    throw new UsageError('The desktop host runs on macOS only for now.');
  }
  const cwd = sys.cwd();
  const reactNative = resolveReactNative(sys, cwd);
  const expo = options.expo ?? readExpoConfig(sys, cwd, os);
  const config = desktopAppConfig(expo);
  if (/[/\\]/.test(config.name) || config.name === '.' || config.name === '..') {
    throw new UsageError(
      `The app name "${config.name}" cannot contain a path separator or be . or .., because the ` +
        'app, its executable and its packages are named for it. Change "name" in app.json.',
    );
  }
  const deny = config.options.deny ?? [];
  const { file, linked, hostLibraries } = writeLinks(sys, { cwd, os, deny });
  const { dir: buildDir, prebuilt } = hostBuildDir(sys, reactNative, {
    ...options,
    os,
    arch: options.arch ?? linuxArch(sys),
    deny,
    linked,
    hostLibraries,
    link: file,
  });
  return { cwd, expo, config, buildDir, prebuilt, reactNative };
}

/**
 * Finds the native code the app links for `os`, warns about each dependency the build leaves
 * without its own, and writes the links for the build (`linkFile`), every time, so a library
 * removed or denied leaves the build with the rest.
 *
 * @param {typeof system} sys
 * @param {{ cwd: string, os: import('./autolink.mjs').DesktopOs, deny: readonly string[] }} app
 */
function writeLinks(sys, { cwd, os, deny }) {
  const links = sys.links(cwd, { os, deny: [...deny], builtIn: HOST_LIBRARIES });
  for (const line of linkWarnings(links)) sys.warn(line);
  const file = linkFile(cwd);
  const { libraries, appModules } = links;
  sys.writeFile(file, `${JSON.stringify({ version: 1, os, libraries, appModules }, null, 2)}\n`);
  // Where autolinking found each host library, under a dependency's node_modules too, else where
  // it resolves from the app (a peer dependency the package manager installed, which the walk
  // does not follow).
  const found = new Map(links.hostLibraries.map(({ name, dir }) => [name, dir]));
  const hostLibraries = HOST_LIBRARIES.filter((name) => !deny.includes(name)).flatMap((name) => {
    const dir = found.get(name) ?? sys.resolvePackage(cwd, name);
    return dir === null ? [] : [{ name, dir }];
  });
  return { file, linked: libraries.length + appModules.length, hostLibraries };
}

/**
 * The prebuilt host that fits, or the one built from source, and which it is. A Linux host builds
 * only on Linux of its own architecture, so it throws for another.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {{ universal: boolean, release?: boolean, os: import('./autolink.mjs').DesktopOs, arch: LinuxArch, deny: readonly string[], linked: number, hostLibraries: { name: string, dir: string }[], link: string }} build
 */
function hostBuildDir(sys, reactNative, build) {
  const { os, arch, hostLibraries } = build;
  const prebuilt = prebuiltHost(sys, reactNative, {
    // A packaged app ships the Release host; a dev run gets the one with the debugger.
    flavour: build.release ? 'release' : 'debug',
    deny: build.deny,
    linked: build.linked,
    hostLibraries,
    os,
    arch,
  });
  if (prebuilt.dir) return { dir: prebuilt.dir, prebuilt: true };
  if (os === 'linux' && !buildsLinuxHere(sys, arch)) {
    throw new UsageError(
      `The Linux desktop host builds on Linux only for now, on the architecture it is for, and no ` +
        `prebuilt Linux ${arch} host fits this app (${prebuilt.reason}). Run this on Linux on ${arch}.`,
    );
  }
  return {
    dir: buildHost(
      sys,
      reactNative,
      hostLibraries.map(({ dir }) => dir),
      build,
      build.link,
    ),
    prebuilt: false,
  };
}

/**
 * @typedef {'x64' | 'arm64'} LinuxArch
 */

/**
 * Whether this machine builds the Linux host for `arch`: Linux, on that architecture, which is
 * one of the two a host is built for (a RISC-V machine is not x64).
 *
 * @param {typeof system} sys
 * @param {LinuxArch} arch
 */
function buildsLinuxHere(sys, arch) {
  return (
    sys.platform === 'linux' && (sys.arch === 'x64' || sys.arch === 'arm64') && sys.arch === arch
  );
}

/**
 * This machine's architecture as a Linux host is built for it.
 *
 * @param {typeof system} sys
 * @returns {LinuxArch}
 */
export function linuxArch(sys) {
  return sys.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * The `hermesc` that compiles a Linux app's bundle, which runs on this machine: on Linux the one
 * beside the host built for this machine's architecture, and on a Mac the one in the prebuilt macOS
 * release host. Both are built from the Hermes the Linux host links, and Hermes bytecode does not
 * depend on the architecture, so one compile serves every package.
 *
 * @param {typeof system} sys
 * @param {{ reactNative: string, hosts: { arch: LinuxArch, buildDir: string }[], expo: ExpoConfig }} build
 *   `hosts` are the Linux hosts already prepared for the packages
 */
export function linuxHermesCompiler(sys, { reactNative, hosts, expo }) {
  if (sys.platform === 'linux') {
    const native = linuxArch(sys);
    const buildDir =
      hosts.find((host) => host.arch === native)?.buildDir ??
      prepareHost(sys, { os: 'linux', arch: native, release: true, universal: false, expo })
        .buildDir;
    const hermesc = path.join(buildDir, 'gtk', 'hermesc');
    if (!sys.exists(hermesc)) {
      throw new Error(
        `The desktop host in ${buildDir} has no hermesc beside it, so the bundle cannot be ` +
          'compiled to Hermes bytecode. Delete that folder and package again to rebuild it.',
      );
    }
    return hermesc;
  }
  const version = versionIn(sys, reactNative);
  const manifest = readManifest(readPrebuiltManifest(sys));
  const choice = version
    ? choosePrebuilt(manifest, {
        reactNative: version,
        flavour: 'release',
        // hermesc is the same whatever the host links.
        linked: 0,
        libraries: {},
        deny: [],
        env: {},
        os: 'macos',
      })
    : { reason: 'react-native has no version' };
  const dir =
    'host' in choice
      ? fetchPrebuilt(
          sys,
          choice.host,
          cacheDir(String(version), { env: sys.env, platform: sys.platform }),
        )
      : null;
  if (!dir) {
    throw new UsageError(
      `Packaging for Linux on a Mac compiles the bundle with the prebuilt macOS host's hermesc, ` +
        `and there is none to use (${'reason' in choice ? choice.reason : 'it did not download'}). ` +
        'Package on Linux instead.',
    );
  }
  return path.join(dir, 'appkit', 'hermesc');
}

/**
 * `prebuilt.json`'s text, or nothing when the package has none.
 *
 * @param {typeof system} sys
 */
function readPrebuiltManifest(sys) {
  try {
    return sys.readFile(path.join(packageDir, 'prebuilt.json'));
  } catch {
    return '';
  }
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
 * The prebuilt host's build folder when `prebuilt.json` has one for this OS and architecture that
 * this app can run on (see `choosePrebuilt`), downloaded into the cache once; otherwise why there
 * is none, and the host is built from source.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {{ flavour: import('./prebuilt.mjs').Flavour, deny: readonly string[], linked: number, hostLibraries: { name: string, dir: string }[], os: import('./autolink.mjs').DesktopOs, arch: LinuxArch }} app
 *   `hostLibraries`: where each host library the app has is installed
 * @returns {{ dir: string, reason?: undefined } | { dir: null, reason: string }}
 */
function prebuiltHost(sys, reactNative, { flavour, deny, linked, hostLibraries, os, arch }) {
  const text = readPrebuiltManifest(sys);
  if (!text) return { dir: null, reason: 'this package lists no prebuilt hosts' };
  const version = versionIn(sys, reactNative);
  if (!version) return { dir: null, reason: 'react-native has no version' };
  const libraries = Object.fromEntries(
    hostLibraries.map(({ name, dir }) => [name, versionIn(sys, dir)]),
  );
  const choice = choosePrebuilt(readManifest(text), {
    reactNative: version,
    flavour,
    linked,
    libraries,
    deny,
    env: sys.env,
    os,
    arch,
  });
  if (!('host' in choice)) return { dir: null, reason: choice.reason };
  const dir = fetchPrebuilt(
    sys,
    choice.host,
    cacheDir(version, { env: sys.env, platform: sys.platform }),
  );
  return dir ? { dir } : { dir: null, reason: 'it did not download' };
}

/**
 * Builds the host (a no-op when nothing changed) and returns its build directory: the AppKit host
 * on a Mac, the GTK one on Linux.
 *
 * @param {typeof system} sys
 * @param {string} reactNative
 * @param {string[]} libraries
 * @param {{ universal: boolean, release?: boolean, os: import('./autolink.mjs').DesktopOs }} options
 * @param {string} link the file `linkFile` names
 */
function buildHost(sys, reactNative, libraries, { universal, release, os }, link) {
  checkToolchain(sys, os);
  const version = versionIn(sys, reactNative);
  if (
    version &&
    !sys.exists(path.join(cacheDir(version, { env: sys.env, platform: sys.platform }), 'host'))
  ) {
    sys.warn(os === 'linux' ? LINUX_FIRST_BUILD_NOTE : FIRST_BUILD_NOTE);
  }
  const buildArgs = [reactNative, ...libraries.flatMap((dir) => ['--library', dir])];
  if (os === 'linux') buildArgs.push('--backend', 'gtk');
  if (universal && os === 'macos') buildArgs.push('--universal');
  // The core tests are the repo's own (`test:native`): the published package has no sources for
  // them, so an app's build leaves them out.
  buildArgs.push(release ? '--release' : '--no-tests');
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

/** @param {NodeJS.Signals} signal */
function osSignal(signal) {
  return constants.signals[signal] ?? 0;
}
