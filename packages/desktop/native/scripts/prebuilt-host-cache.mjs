/**
 * A built prebuilt host kept between release runs (make-prebuilt.mjs --host-cache), so a release
 * whose host inputs did not change packs the host it already built instead of building it again.
 *
 * The cache holds the build's host files as the build left them, before they are stripped and
 * signed, in the folder the build has them in (`appkit/` for macOS, `gtk/` for Linux), and a
 * `host.json` naming the inputs key they were built from and each file's digest. A cache is used
 * only when its key is the one computed now and every file still has its digest; anything else
 * builds from scratch.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ folder: string, files: readonly string[] }} HostLayout The build's subfolder the host
 *   is in, and the files make-prebuilt.mjs archives from it, which the cache holds.
 */

/** @type {HostLayout} The universal AppKit host. */
export const MACOS_HOST = {
  folder: 'appkit',
  files: ['ngn-macos', 'hermesc', 'hermesvm.framework', 'Sparkle.framework'],
};

/** @type {HostLayout} The GTK host, for one architecture. */
export const LINUX_HOST = { folder: 'gtk', files: ['ngn-linux', 'hermesc'] };

/** Bumped when the cache's layout or what the key covers changes, so older caches miss. */
const SCHEMA = 1;

/** @param {string | Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Where a host build installs React Native and its host libraries when the app has another React
 * Native (make-prebuilt.mjs --react-native): a folder in that version's build cache named for the
 * versions, so builds of different versions never share an install, and builds of the same ones
 * keep one path, which a compiler cache keys on.
 *
 * @param {string} cacheDir the version's build cache (cache-dir.sh)
 * @param {Record<string, string>} versions each package's version
 */
export function hostAppDir(cacheDir, versions) {
  const sorted = Object.keys(versions)
    .sort()
    .map((name) => `${name}@${versions[name]}`);
  const hash = createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16);
  return path.join(cacheDir, `app-${hash}`);
}

/**
 * Each file under `root` (a file or a directory), by its path relative to `base`, with the SHA-256
 * of its contents, or `link:<target>` for a symbolic link, which is never followed. Sorted.
 *
 * @param {string} base
 * @param {string} root
 * @returns {[string, string][]}
 */
export function treeDigests(base, root) {
  /** @type {[string, string][]} */
  const out = [];
  /** @param {string} file */
  const walk = (file) => {
    const stat = lstatSync(file);
    const rel = path.relative(base, file).split(path.sep).join('/');
    if (stat.isSymbolicLink()) out.push([rel, `link:${readlinkSync(file)}`]);
    else if (stat.isDirectory()) for (const name of readdirSync(file)) walk(path.join(file, name));
    else if (stat.isFile()) out.push([rel, sha256(readFileSync(file))]);
    else throw new Error(`${file} is neither a file, a directory nor a link.`);
  };
  walk(root);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The key of everything a prebuilt host is built from. Any change to one of these is a host that
 * may differ, and builds again.
 *
 * @param {{
 *   flavour: string,
 *   reactNative: string,
 *   libraries: Record<string, string>,
 *   sources: [string, string][],
 *   toolchain: string,
 *   signing: string,
 *   platform?: { os?: string, arch?: string },
 * }} inputs `libraries`: each compiled-in library's version. `sources`: the digests
 *   (treeDigests) of the host's native sources and build scripts. `toolchain`: the compiler and SDK,
 *   or for Linux the compiler, glibc and the build image's libraries. `signing`: the identity the
 *   archive is signed with, `-` for ad hoc. `platform`: the OS and architecture of a Linux host;
 *   left out for the universal macOS host, whose key it leaves as it was.
 */
export function hostInputsKey({
  flavour,
  reactNative,
  libraries,
  sources,
  toolchain,
  signing,
  platform,
}) {
  const sortedLibraries = Object.fromEntries(
    Object.entries(libraries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return sha256(
    JSON.stringify({
      schema: SCHEMA,
      flavour,
      reactNative,
      libraries: sortedLibraries,
      sources,
      toolchain,
      signing,
      platform,
    }),
  );
}

/**
 * The cached host's folder when `dir` holds a host built from `key` whose files are all as they
 * were saved, else null with why: a cache that is missing, from other inputs, short of a file or
 * changed in any byte is never used.
 *
 * @param {string} dir
 * @param {string} key
 * @param {HostLayout} [layout]
 * @returns {{ host: string, reason?: undefined } | { host: null, reason: string }}
 */
export function readHostCache(dir, key, layout = MACOS_HOST) {
  const record = path.join(dir, 'host.json');
  if (!existsSync(record)) return { host: null, reason: `no built host in ${dir}` };
  /** @type {{ schema?: number, key?: string, files?: [string, string][] }} */
  let saved;
  try {
    saved = JSON.parse(readFileSync(record, 'utf8'));
  } catch (error) {
    return {
      host: null,
      reason: `${record} is unreadable: ${/** @type {Error} */ (error).message}`,
    };
  }
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
    return { host: null, reason: `${record} is not a host record` };
  }
  if (saved.schema !== SCHEMA || saved.key !== key) {
    return { host: null, reason: `the host in ${dir} was built from other inputs` };
  }
  const host = path.join(dir, layout.folder);
  const reason = changedFrom(host, layout.files, saved.files);
  return reason ? { host: null, reason: `the host in ${dir} ${reason}` } : { host };
}

/**
 * Why the host in `host` is not the one saved with `digests`, or null where every file is there
 * and as it was.
 *
 * @param {string} host
 * @param {readonly string[]} files
 * @param {unknown} digests
 */
function changedFrom(host, files, digests) {
  try {
    const gone = files.find((name) => !existsSync(path.join(host, name)));
    if (gone) return `has no ${gone}`;
    const same = JSON.stringify(treeDigests(host, host)) === JSON.stringify(digests);
    return same ? null : 'is not as it was saved';
  } catch (error) {
    return `is unreadable: ${/** @type {Error} */ (error).message}`;
  }
}

/**
 * Replaces `dir` with the host files in `built` (a build's host folder, before stripping and
 * signing) and the record naming `key`. The record goes in last, so a copy cut short is never read
 * as a host.
 *
 * @param {string} dir
 * @param {string} key
 * @param {string} built
 * @param {HostLayout} [layout]
 */
export function writeHostCache(dir, key, built, layout = MACOS_HOST) {
  rmSync(dir, { recursive: true, force: true });
  const target = path.join(dir, layout.folder);
  for (const name of layout.files) {
    cpSync(path.join(built, name), path.join(target, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  const files = treeDigests(target, target);
  writeFileSync(
    path.join(dir, 'host.json'),
    `${JSON.stringify({ schema: SCHEMA, key, files }, null, 2)}\n`,
  );
}
