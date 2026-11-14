/**
 * The `ng-native-desktop` command: builds the desktop host when it needs building and launches it.
 *
 *     ng-native-desktop run <bundle path or URL> [--module <name>] [--universal]
 *
 * The host is built in the per-user cache (see `cacheDir`) from the pinned sources
 * `native/scripts/fetch.sh` fetches, against the app's own `react-native`. A URL is downloaded to
 * a temporary file first: the host reads bundles from disk until it has an HTTP client.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const USAGE = `Usage: ng-native-desktop run <bundle path or URL> [--module <name>] [--universal]

Builds the macOS desktop host if it needs building, then opens the bundle in it.

  --module <name>   the registered app to start (default: main)
  --universal       build for arm64 and x86_64 (default: this Mac's architecture)`;

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
 * @returns {{ command: 'help' } | { command: 'run', bundle: string, module: string, universal: boolean }}
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
      universal: { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1) {
    throw new UsageError('run takes one bundle path or URL.');
  }
  return {
    command: 'run',
    bundle: positionals[0],
    module: values.module,
    universal: values.universal,
  };
}

export class UsageError extends Error {}

/** @param {string} bundle */
export function isUrl(bundle) {
  return /^https?:\/\//i.test(bundle);
}

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
  /** @param {string} url */
  async download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ng-native-desktop-')), 'bundle.js');
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return file;
  },
};

/**
 * Builds the host (a no-op when nothing changed) and runs it on the bundle. Returns the host's
 * exit status.
 *
 * @param {{ bundle: string, module: string, universal: boolean }} options
 * @param {typeof system} [sys]
 */
export async function run(options, sys = system) {
  if (sys.platform !== 'darwin') {
    throw new UsageError('The desktop host runs on macOS only for now.');
  }
  const cwd = sys.cwd();
  let reactNative;
  try {
    reactNative = sys.resolveReactNative(cwd);
  } catch {
    throw new UsageError(
      `react-native is not installed in ${cwd}. Run this from the app's directory.`,
    );
  }
  const buildArgs = [reactNative];
  if (options.universal) buildArgs.push('--universal');
  const build = sys.run(path.join(packageDir, 'native', 'scripts', 'build.sh'), buildArgs, {
    capture: true,
  });
  const buildDir = build.stdout.trim().split('\n').pop();
  if (build.status !== 0 || !buildDir) {
    throw new Error('The desktop host did not build; the output above says why.');
  }
  const bundle = isUrl(options.bundle)
    ? await sys.download(options.bundle)
    : path.resolve(cwd, options.bundle);
  return sys.run(path.join(buildDir, 'appkit', 'ngn-macos'), [bundle, '--module', options.module])
    .status;
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
