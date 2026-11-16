/**
 * A built prebuilt host kept between release runs (make-prebuilt.mjs --host-cache), so a release
 * whose host inputs did not change packs the host it already built instead of building it again.
 *
 * The cache holds the build's `appkit/` files as the build left them, before they are stripped and
 * signed, and a `host.json` naming the inputs key they were built from and each file's digest. A
 * cache is used only when its key is the one computed now and every file still has its digest;
 * anything else builds from scratch.
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

/** What the cache holds, under `appkit/`: the files make-prebuilt.mjs archives. */
export const HOST_FILES = ['ngn-macos', 'hermesc', 'Sparkle.framework'];

/** Bumped when the cache's layout or what the key covers changes, so older caches miss. */
const SCHEMA = 1;

/** @param {string | Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

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
 * }} inputs `libraries`: each compiled-in library's version. `sources`: the digests
 *   (treeDigests) of the host's native sources and build scripts. `toolchain`: the compiler and SDK.
 *   `signing`: the identity the archive is signed with, `-` for ad hoc.
 */
export function hostInputsKey({ flavour, reactNative, libraries, sources, toolchain, signing }) {
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
    }),
  );
}

/**
 * The cached host's `appkit` folder when `dir` holds a host built from `key` whose files are all as
 * they were saved, else null with why: a cache that is missing, from other inputs, short of a file
 * or changed in any byte is never used.
 *
 * @param {string} dir
 * @param {string} key
 * @returns {{ appkit: string, reason?: undefined } | { appkit: null, reason: string }}
 */
export function readHostCache(dir, key) {
  const record = path.join(dir, 'host.json');
  if (!existsSync(record)) return { appkit: null, reason: `no built host in ${dir}` };
  /** @type {{ schema?: number, key?: string, files?: [string, string][] }} */
  let saved;
  try {
    saved = JSON.parse(readFileSync(record, 'utf8'));
  } catch (error) {
    return {
      appkit: null,
      reason: `${record} is unreadable: ${/** @type {Error} */ (error).message}`,
    };
  }
  if (saved.schema !== SCHEMA || saved.key !== key) {
    return { appkit: null, reason: `the host in ${dir} was built from other inputs` };
  }
  const appkit = path.join(dir, 'appkit');
  try {
    for (const name of HOST_FILES) {
      if (!existsSync(path.join(appkit, name))) {
        return { appkit: null, reason: `the host in ${dir} has no ${name}` };
      }
    }
    const now = JSON.stringify(treeDigests(appkit, appkit));
    if (now !== JSON.stringify(saved.files)) {
      return { appkit: null, reason: `the host in ${dir} is not as it was saved` };
    }
  } catch (error) {
    return {
      appkit: null,
      reason: `the host in ${dir} is unreadable: ${/** @type {Error} */ (error).message}`,
    };
  }
  return { appkit };
}

/**
 * Replaces `dir` with the host files in `appkit` (a build's, before stripping and signing) and the
 * record naming `key`. The record goes in last, so a copy cut short is never read as a host.
 *
 * @param {string} dir
 * @param {string} key
 * @param {string} appkit
 */
export function writeHostCache(dir, key, appkit) {
  rmSync(dir, { recursive: true, force: true });
  const target = path.join(dir, 'appkit');
  for (const name of HOST_FILES) {
    cpSync(path.join(appkit, name), path.join(target, name), {
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
