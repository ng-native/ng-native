#!/usr/bin/env node
/**
 * Builds the prebuilt desktop host for one React Native version and flavour and packs it for a
 * release.
 *
 *   make-prebuilt.mjs <app> <out> [--flavour debug|release] [--version <v>] [--base-url <url>]
 *                     [--manifest <prebuilt.json>] [--host-cache <dir>] [--reuse <prebuilt.json>]
 *                     [--reuse-only] [--build-dir <dir>]
 *   make-prebuilt.mjs <app> --print-key [--flavour debug|release]
 *
 * - <app>: the app whose react-native and host libraries (react-native-screens,
 *   react-native-safe-area-context) the host is built against: the desktop template.
 * - <out>: where the archive and `prebuilt-host-<flavour>.json`, its manifest entry, go. Runs into
 *   the same folder take turns there (publishPrebuilt), so the two always come from the same build.
 * - --flavour: `release` (the default), the universal Release build a packaged app ships
 *   (`build.sh --universal --release`), or `debug`, the universal dev build `run` uses
 *   (`build.sh --universal --no-tests`), which carries React Native's debugger.
 * - --version: the release the archive is named for (default: this package's version), for a
 *   release whose version is not yet in package.json.
 * - --base-url: where the release serves the archive, an absolute http or https URL with no query
 *   or fragment; the archive's URL is this and its name. Needed with --manifest, since the CLI
 *   downloads from the URL as it is.
 * - --manifest: a `prebuilt.json` to write the entry into, in place of the one for the same React
 *   Native version and flavour.
 * - --host-cache: a folder keeping the built host between runs (prebuilt-host-cache.mjs). When it
 *   holds a host built from the same inputs (the host's native sources and build scripts, React
 *   Native's and each compiled-in library's version, the flavour, the compiler and the SDK), that
 *   host is stripped, signed and packed with no build; otherwise the host is built and the folder
 *   replaced with it. An inputs key that cannot be computed builds without the cache.
 * - --reuse: a `prebuilt.json` of an earlier release. When its entry for this React Native version
 *   and flavour records the same inputs key, its archive is downloaded, checked against the entry's
 *   SHA-256 and published again under this release's name, byte for byte. A different key, a failed
 *   download or a checksum that does not match falls back to --host-cache or a build.
 * - --reuse-only: with --reuse, stop there when the archive cannot be reused, exiting with 3 and
 *   writing nothing, so a caller can prepare a build's caches before it builds.
 * - --build-dir: build here, a folder that must be missing or empty, instead of a fresh temp folder:
 *   a fixed path lets a compiler cache such as ccache hit from one run to the next.
 * - --print-key: print the inputs key --host-cache checks against, and nothing else.
 *
 * The host has no app's linked code and is built from scratch in a directory of its own, so no other
 * build can replace it before it is archived. `ngn-macos` and `hermesc` have their local symbols
 * stripped and are signed with the hardened runtime, ad hoc (`codesign --sign -`) unless `NGN_SIGN_IDENTITY` names an identity: an
 * app re-signs the host when it packages, so the release needs no Developer ID. Nothing is uploaded.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { HOST_LIBRARIES, packageDir } from '../../bin/host.mjs';
import {
  FLAVOURS,
  flavourOf,
  prebuiltName,
  publishPrebuilt,
  readManifest,
  signPrebuiltFiles,
} from '../../bin/prebuilt.mjs';
import {
  HOST_FILES,
  hostInputsKey,
  readHostCache,
  treeDigests,
  writeHostCache,
} from './prebuilt-host-cache.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} command @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}).`);
  return result;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    flavour: { type: 'string', default: 'release' },
    version: { type: 'string' },
    'base-url': { type: 'string' },
    manifest: { type: 'string' },
    'host-cache': { type: 'string' },
    'build-dir': { type: 'string' },
    reuse: { type: 'string' },
    'reuse-only': { type: 'boolean', default: false },
    'print-key': { type: 'boolean', default: false },
  },
});
const [appArg, outArg] = positionals;
const printKey = values['print-key'];
if (!appArg || (!outArg && !printKey)) {
  console.error(
    'Usage: make-prebuilt.mjs <app> <out> [--flavour debug|release] [--version <v>] [--base-url <url>] [--manifest <prebuilt.json>] [--host-cache <dir>] [--reuse <prebuilt.json> [--reuse-only]] [--build-dir <dir>]\n       make-prebuilt.mjs <app> --print-key [--flavour debug|release]',
  );
  process.exit(2);
}
if (values['reuse-only'] && !values.reuse) {
  console.error('--reuse-only needs --reuse, the prebuilt.json whose archive to reuse.');
  process.exit(2);
}
const flavour = /** @type {import('../../bin/prebuilt.mjs').Flavour} */ (values.flavour);
if (!FLAVOURS.includes(flavour)) {
  console.error(`--flavour takes debug or release, not "${values.flavour}".`);
  process.exit(2);
}
const baseUrl = values['base-url'];
if (values.manifest !== undefined || baseUrl !== undefined) {
  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(baseUrl ?? '');
  } catch {}
  // A query or a fragment would end up holding the archive's name.
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || /[?#]/.test(baseUrl ?? '')) {
    console.error(
      baseUrl === undefined
        ? '--manifest needs --base-url, the absolute URL the release serves the archive from.'
        : `--base-url takes the absolute http or https URL the release serves the archive from, with no query or fragment, not "${baseUrl}".`,
    );
    process.exit(2);
  }
}
const buildDirArg = values['build-dir'] && path.resolve(values['build-dir']);
if (buildDirArg && existsSync(buildDirArg) && readdirSync(buildDirArg).length > 0) {
  // The host is always built from scratch: an earlier build's files could end up in it.
  console.error(`--build-dir takes a missing or empty folder, and ${buildDirArg} is not empty.`);
  process.exit(2);
}
const app = path.resolve(appArg);
const out = path.resolve(outArg ?? '.');
const require = createRequire(path.join(app, 'package.json'));
/** @param {string} name */
const installed = (name) => {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
};
/** @param {string} dir */
const versionOf = (dir) =>
  String(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version);

const reactNativeDir = installed('react-native');
if (!reactNativeDir) throw new Error(`react-native is not installed in ${app}.`);
const reactNative = versionOf(reactNativeDir);
const libraries = Object.fromEntries(
  HOST_LIBRARIES.flatMap((name) => {
    const dir = installed(name);
    return dir ? [[name, dir]] : [];
  }),
);

const libraryVersions = Object.fromEntries(
  Object.entries(libraries).map(([lib, dir]) => [lib, versionOf(dir)]),
);

/** @param {string} command @param {string[]} args */
const capture = (command, args) =>
  run(command, args, { stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim();

/** The key of everything the host is built from (prebuilt-host-cache.mjs hostInputsKey). */
function inputsKey() {
  const desktop = path.resolve(here, '..', '..');
  return hostInputsKey({
    flavour,
    reactNative,
    libraries: libraryVersions,
    // The native sources and every build script, and the list of libraries compiled in.
    sources: [
      path.join(desktop, 'native'),
      path.join(desktop, 'bin', 'host.mjs'),
      path.join(desktop, 'bin', 'prebuilt.mjs'),
    ].flatMap((root) => treeDigests(desktop, root)),
    toolchain: [
      capture('xcrun', ['clang', '--version']),
      capture('xcrun', ['--show-sdk-version']),
    ].join('\n'),
    // A reused archive is signed: another identity is another archive.
    signing: process.env['NGN_SIGN_IDENTITY'] || '-',
  });
}

if (printKey) {
  console.log(inputsKey());
  process.exit(0);
}

const hostCache = values['host-cache'] && path.resolve(values['host-cache']);
const reuse = values.reuse && path.resolve(values.reuse);
/** @type {string | null} */
let key = null;
if (hostCache || reuse) {
  try {
    key = inputsKey();
  } catch (error) {
    console.error(
      `make-prebuilt: no inputs key (${/** @type {Error} */ (error).message}); building from scratch.`,
    );
  }
}

/**
 * Downloads into `packed` the archive `manifestFile` names for this React Native version and
 * flavour, when its entry was built from `key` and the download has the entry's SHA-256. Returns
 * why not otherwise, having written nothing.
 *
 * @param {string} manifestFile
 * @param {string} inputs
 * @param {string} packed
 */
async function reuseArchive(manifestFile, inputs, packed) {
  try {
    const entry = readManifest(readFileSync(manifestFile, 'utf8')).hosts.find(
      (each) => each.reactNative === reactNative && flavourOf(each) === flavour,
    );
    if (!entry) return `${manifestFile} has no ${flavour} host for React Native ${reactNative}`;
    if (entry.inputs !== inputs)
      return `the ${flavour} host in ${manifestFile} was built from other inputs`;
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok) return `${entry.url} answered ${response.status}`;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      return `${entry.url} does not match the SHA-256 in ${manifestFile}`;
    }
    writeFileSync(packed, bytes);
    return null;
  } catch (error) {
    return `the host in ${manifestFile} could not be reused: ${/** @type {Error} */ (error).message}`;
  }
}

const desktopVersion = values.version ?? versionOf(packageDir);
const name = prebuiltName(desktopVersion, reactNative, flavour);
mkdirSync(out, { recursive: true });
// Packed at a name of its own in <out>, and moved into place with its entry by publishPrebuilt.
const packed = path.join(out, `.${name}.${process.pid}.partial`);
const staging = mkdtempSync(path.join(tmpdir(), 'ngn-prebuilt-'));
try {
  const appkit = path.join(staging, 'appkit');
  let reused = false;
  if (reuse && key) {
    const why = await reuseArchive(reuse, key, packed);
    if (why === null) {
      // Unpacked only to be checked below like a host packed here.
      run('tar', ['-xzf', packed, '-C', staging]);
      reused = true;
      console.error(
        `make-prebuilt: reusing the host ${reuse} names, built from these inputs (${key}).`,
      );
    } else {
      console.error(`make-prebuilt: ${why}; not reusing it.`);
    }
  }
  if (!reused && values['reuse-only']) {
    // Nothing was written to <out>, and process.exit skips the finally below.
    rmSync(staging, { recursive: true, force: true });
    console.error('make-prebuilt: --reuse-only: nothing to reuse, so nothing is built.');
    process.exit(3);
  }
  /** @type {string | null} */
  let built = null;
  if (!reused) {
    /** @type {string | null} */
    let source = null;
    if (hostCache && key) {
      const cached = readHostCache(hostCache, key);
      if (cached.appkit) {
        source = cached.appkit;
        console.error(
          `make-prebuilt: packing the host built from these inputs (${key}) in ${hostCache}.`,
        );
      } else {
        console.error(`make-prebuilt: ${cached.reason}; building the host.`);
      }
    }
    if (source === null) {
      const buildRoot = buildDirArg ?? path.join(staging, 'build');
      const build = run(
        path.join(here, 'build.sh'),
        [
          reactNativeDir,
          '--universal',
          // The debug host is the dev build an app's `run` makes, with React Native's debugger.
          flavour === 'release' ? '--release' : '--no-tests',
          ...Object.values(libraries).flatMap((dir) => ['--library', dir]),
          '--build-dir',
          buildRoot,
        ],
        { stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, NGN_DESKTOP_LINK: '' } },
      );
      source = built = path.join(build.stdout.trim().split('\n').pop() ?? '', 'appkit');
    }
    mkdirSync(appkit, { recursive: true });
    for (const file of HOST_FILES) {
      cpSync(path.join(source, file), path.join(appkit, file), {
        recursive: true,
        verbatimSymlinks: true,
      });
    }
    signPrebuiltFiles(
      run,
      ['ngn-macos', 'hermesc'].map((file) => path.join(appkit, file)),
      process.env,
    );
  }
  for (const file of HOST_FILES) {
    if (!existsSync(path.join(appkit, file))) throw new Error(`The host has no ${file}.`);
  }
  const archs = run('lipo', ['-archs', path.join(appkit, 'ngn-macos')], {
    stdio: ['inherit', 'pipe', 'inherit'],
  }).stdout.trim();
  if (archs.split(' ').sort().join(' ') !== 'arm64 x86_64') {
    throw new Error(`ngn-macos is built for ${archs}, not arm64 and x86_64.`);
  }
  // Kept as the build left it, unstripped and unsigned, for the next run with the same inputs.
  if (built && hostCache && key) writeHostCache(hostCache, key, built);

  // Owner and group dropped, so the archive does not carry the build machine's.
  if (!reused) run('tar', ['-czf', packed, '--uid', '0', '--gid', '0', '-C', staging, 'appkit']);
  const sha256 = createHash('sha256').update(readFileSync(packed)).digest('hex');
  const host = {
    reactNative,
    flavour,
    url: `${(baseUrl ?? '').replace(/\/$/, '')}/${name}`,
    sha256,
    libraries: libraryVersions,
    // What the next release compares with to reuse this archive (--reuse).
    ...(key ? { inputs: key } : {}),
  };
  publishPrebuilt({
    out,
    archive: packed,
    name,
    host,
    manifest: values.manifest && path.resolve(values.manifest),
  });
  console.log(`${path.join(out, name)}\n${JSON.stringify(host, null, 2)}`);
} finally {
  rmSync(packed, { force: true });
  rmSync(staging, { recursive: true, force: true });
}
