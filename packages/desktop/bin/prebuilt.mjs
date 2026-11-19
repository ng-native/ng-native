/**
 * Prebuilt desktop hosts: the signed, universal hosts each release publishes per React Native
 * version, so an app with no native desktop code of its own compiles nothing. Each version has two
 * flavours: `debug`, the dev build `run` uses, which carries React Native's debugger, and
 * `release`, the Release build `package` ships, which leaves it out.
 *
 * `prebuilt.json` beside this package lists them, one entry per version and flavour; an entry
 * that names no flavour is a release host. The release workflow writes each entry before
 * the package is packed (`docs/desktop-host.md` has the steps), so the SHA-256 of each archive
 * travels inside the npm package, not beside the archive it vouches for. An archive holds `appkit/ngn-macos`, `appkit/hermesc`,
 * `appkit/hermesvm.framework` and `appkit/Sparkle.framework`, the files a host build's `appkit` folder has, and unpacks into the
 * per-user cache under its own hash, so a new archive never reuses an old one's files.
 *
 * `native/scripts/make-prebuilt.mjs` builds and packs one. The host is signed ad hoc unless
 * `NGN_SIGN_IDENTITY` names an identity: an app re-signs it when it packages, and the download is
 * checked by SHA-256, so no Developer ID is needed.
 */
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The manifest's format, which `prebuilt.json` names. */
export const MANIFEST_VERSION = 1;

/** The flavours a prebuilt host comes in. */
export const FLAVOURS = /** @type {const} */ (['debug', 'release']);

/**
 * @typedef {typeof FLAVOURS[number]} Flavour
 * @typedef {{ reactNative: string, flavour?: Flavour, url: string, sha256: string, libraries: Record<string, string>, inputs?: string }} PrebuiltHost
 *   `flavour` is `release` when it is left out, as a manifest from before the debug host has it.
 *   `inputs` is the key of what the host was built from (native/scripts/prebuilt-host-cache.mjs),
 *   which the next release's make-prebuilt.mjs --reuse compares with its own
 * @typedef {{ version: number, hosts: PrebuiltHost[] }} PrebuiltManifest
 * @typedef {import('./host.mjs').system} System
 */

/**
 * The archive's file name for a release of this package, a React Native version and a flavour.
 * The release host's name has no flavour in it.
 *
 * @param {string} desktopVersion
 * @param {string} reactNative
 * @param {Flavour} [flavour]
 */
export function prebuiltName(desktopVersion, reactNative, flavour = 'release') {
  const suffix = flavour === 'release' ? '' : `-${flavour}`;
  return `ng-native-desktop-host-${desktopVersion}-rn-${reactNative}-macos-universal${suffix}.tar.gz`;
}

/**
 * The file `make-prebuilt.mjs` writes a host's manifest entry to, beside its archive: one per
 * flavour, so both flavours' builds can share a folder.
 *
 * @param {Flavour} flavour
 */
export function entryName(flavour) {
  return `prebuilt-host-${flavour}.json`;
}

/**
 * A host's flavour: `release` when its entry names none.
 *
 * @param {PrebuiltHost} host
 * @returns {Flavour}
 */
export function flavourOf(host) {
  return host.flavour ?? 'release';
}

/**
 * The manifest in `text`, or an empty one for text that is not a manifest of this version.
 *
 * @param {string} text
 * @returns {PrebuiltManifest}
 */
export function readManifest(text) {
  try {
    const manifest = JSON.parse(text);
    if (manifest?.version === MANIFEST_VERSION && Array.isArray(manifest.hosts)) return manifest;
  } catch {
    // Not a manifest: none, below.
  }
  return { version: MANIFEST_VERSION, hosts: [] };
}

/**
 * `manifest` with `host` in it, in place of the one for the same React Native version and flavour.
 *
 * @param {PrebuiltManifest} manifest
 * @param {PrebuiltHost} host
 * @returns {PrebuiltManifest}
 */
export function withHost(manifest, host) {
  const hosts = manifest.hosts.filter(
    (each) => each.reactNative !== host.reactNative || flavourOf(each) !== flavourOf(host),
  );
  return { version: MANIFEST_VERSION, hosts: [...hosts, host] };
}

/**
 * Puts a packed archive in `out` under its name, with its manifest entry (`entryName`), and writes
 * the entry into `manifest` when one is given. Runs into the same folder take turns, holding
 * `<out>/.make-prebuilt.lock`, and the manifest's folder's lock too when it is elsewhere, so the
 * archive, its entry and the manifest always describe the same build and no run's manifest entry is
 * lost; each file is replaced by a rename, so none is seen half written. An archive already in
 * `out` under `name` is never replaced, since a manifest may name it with its hash.
 *
 * @param {{ out: string, archive: string, name: string, host: PrebuiltHost, manifest?: string }} files
 *   `archive` is the packed archive at a temporary name in `out`
 * @param {{ wait?: number }} [options] how long to wait for another run, in milliseconds
 */
export function publishPrebuilt({ out, archive, name, host, manifest }, { wait = 600_000 } = {}) {
  // The manifest's folder too when it is elsewhere, since another run may be updating it: by real
  // path, so one folder reached two ways is locked once, and in path order, so two runs never each
  // hold the lock the other waits for.
  const folders = [
    ...new Set([out, ...(manifest ? [path.dirname(manifest)] : [])].map((f) => realpathSync(f))),
  ].sort();
  const give = Date.now() + wait;
  /** @type {string[]} */
  const held = [];
  /** @param {string} file @param {string} text */
  const replace = (file, text) => {
    const temp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(temp, text);
    renameSync(temp, file);
  };
  try {
    for (const folder of folders) {
      held.push(takeLock(path.join(folder, '.make-prebuilt.lock'), give));
    }
    // A published archive is never replaced: a manifest written by another run may name it with
    // its hash. A rebuild under the same name needs the old archive removed first.
    const target = path.join(out, name);
    if (existsSync(target)) {
      rmSync(archive, { force: true });
      throw new Error(`${target} is already published. Remove it first to publish another build.`);
    }
    renameSync(archive, target);
    replace(path.join(out, entryName(flavourOf(host))), `${JSON.stringify(host, null, 2)}\n`);
    if (manifest) {
      const updated = withHost(readManifest(readFileSync(manifest, 'utf8')), host);
      replace(manifest, `${JSON.stringify(updated, null, 2)}\n`);
    }
  } finally {
    for (const lock of held.reverse()) rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Makes `lock`, waiting until `give` (a time in milliseconds) while another run holds it.
 *
 * @param {string} lock
 * @param {number} give
 * @returns {string} the lock
 */
function takeLock(lock, give) {
  for (;;) {
    try {
      mkdirSync(lock);
      return lock;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      if (Date.now() >= give) {
        throw new Error(
          `Another make-prebuilt.mjs run holds ${lock}. Wait for it, or remove the folder if ` +
            'no run is left.',
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/**
 * The prebuilt host an app can run on, or why it builds its own: one is used only for the app's
 * React Native version and the flavour asked for, when the app links no native desktop code, and
 * when each host library it has is the version the host was built with and is not denied.
 *
 * @param {PrebuiltManifest} manifest
 * @param {{ reactNative: string, flavour: Flavour, linked: number, libraries: Record<string, string | null>, deny: readonly string[], env: Record<string, string | undefined> }} app
 *   `flavour` is `debug` for a dev run and `release` for a packaged app; `libraries` holds each
 *   host library's installed version, or null where the app lacks it
 * @returns {{ host: PrebuiltHost } | { reason: string }}
 */
export function choosePrebuilt(manifest, { reactNative, flavour, linked, libraries, deny, env }) {
  if (env['NGN_DESKTOP_FROM_SOURCE'] === '1') return { reason: 'NGN_DESKTOP_FROM_SOURCE=1' };
  if (linked > 0) return { reason: 'the app links native desktop code' };
  const host = manifest.hosts.find(
    (each) => each.reactNative === reactNative && flavourOf(each) === flavour,
  );
  if (!host) return { reason: `no prebuilt ${flavour} host for React Native ${reactNative}` };
  for (const name of Object.keys(host.libraries)) {
    if (deny.includes(name)) return { reason: `${name} is denied, and the prebuilt host has it` };
  }
  for (const [name, version] of Object.entries(libraries)) {
    if (version === null) continue;
    if (host.libraries[name] !== version) {
      return {
        reason: `the prebuilt host has ${name} ${host.libraries[name] ?? 'left out'}, the app ${version}`,
      };
    }
  }
  return { host };
}

/**
 * The prebuilt host's build folder in the cache, downloading, checking and unpacking it first when
 * it is not there. Null, with a warning, when it cannot be downloaded, so the host is built from
 * source instead; a download whose SHA-256 is not the manifest's throws, and is deleted. Each run
 * downloads and unpacks into names of its own, so two first runs at once never touch each other's
 * files, and a run that finds the host unpacked by another when it is done uses that one.
 *
 * @param {System} sys
 * @param {PrebuiltHost} host
 * @param {string} cache the React Native version's folder in the per-user cache
 * @returns {string | null}
 */
export function fetchPrebuilt(sys, host, cache) {
  if (!/^[0-9a-f]{64}$/.test(host.sha256)) {
    throw new Error(
      `prebuilt.json gives the React Native ${host.reactNative} ${flavourOf(host)} host no SHA-256 to check.`,
    );
  }
  const dir = path.join(cache, 'prebuilt', host.sha256.slice(0, 16));
  if (sys.exists(path.join(dir, 'appkit', 'ngn-macos'))) return dir;
  const own = `${dir}.${process.pid}-${randomBytes(4).toString('hex')}`;
  const archive = `${own}.tar.gz`;
  const unpacked = `${own}.partial`;
  const got = sys.run(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--retry',
      '3',
      '--create-dirs',
      '-o',
      archive,
      host.url,
    ],
    { capture: true },
  );
  if (got.status !== 0) {
    sys.remove(archive);
    sys.warn(
      `Could not download the prebuilt desktop host from ${host.url}, so it is built from source.`,
    );
    return null;
  }
  const sha256 = sys.sha256(archive);
  if (sha256 !== host.sha256) {
    sys.remove(archive);
    throw new Error(
      `The prebuilt desktop host from ${host.url} has SHA-256 ${sha256}, not the ${host.sha256} ` +
        'this package names, so it was deleted unused. Set NGN_DESKTOP_FROM_SOURCE=1 to build ' +
        'the host from source.',
    );
  }
  sys.writeFile(path.join(unpacked, '.sha256'), `${sha256}\n`);
  const tar = sys.run('tar', ['-xzf', archive, '-C', unpacked], { capture: true });
  sys.remove(archive);
  if (tar.status !== 0 || !sys.exists(path.join(unpacked, 'appkit', 'ngn-macos'))) {
    sys.remove(unpacked);
    throw new Error(
      `The prebuilt desktop host from ${host.url} did not unpack to appkit/ngn-macos.`,
    );
  }
  // Published by one atomic rename, which fails rather than replace a folder that holds a host,
  // so a host another run has published is never deleted under it.
  const binary = path.join(dir, 'appkit', 'ngn-macos');
  try {
    if (!sys.exists(binary)) sys.rename(unpacked, dir);
  } catch (error) {
    // Another run moved its copy in first.
    if (!sys.exists(binary)) throw error;
  } finally {
    sys.remove(unpacked);
  }
  return dir;
}

/**
 * The entitlements of an ad hoc signed host with the hardened runtime. Library validation loads
 * only libraries from the process's own team, and an ad hoc signature has none, so it would refuse
 * React Native's Hermes framework beside the binary. A real identity signs the framework too and
 * keeps validation.
 */
export const AD_HOC_HOST_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
</dict>
</plist>
`;

/**
 * Strips each file's local symbols, then signs it with the hardened runtime: with
 * `NGN_SIGN_IDENTITY` when that is set and not empty, ad hoc (`--sign -`, no timestamp) otherwise.
 * `adHocEntitlements` go with an ad hoc signature only. A framework is signed as it is, unstripped.
 * Throws when a command fails.
 *
 * @param {(command: string, args: string[]) => { status: number | null }} run
 * @param {string[]} files
 * @param {Record<string, string | undefined>} env
 * @param {string} [adHocEntitlements]
 */
export function signPrebuiltFiles(run, files, env, adHocEntitlements) {
  const identity = env['NGN_SIGN_IDENTITY'] || '-';
  const entitlements =
    identity === '-' && adHocEntitlements ? ['--entitlements', adHocEntitlements] : [];
  for (const file of files) {
    // Before signing, which stripping would break.
    for (const [command, args] of /** @type {[string, string[]][]} */ ([
      ...(file.endsWith('.framework') ? [] : [['strip', ['-x', file]]]),
      [
        'codesign',
        [
          '--force',
          '--options',
          'runtime',
          identity === '-' ? '--timestamp=none' : '--timestamp',
          ...entitlements,
          '--sign',
          identity,
          file,
        ],
      ],
    ])) {
      const result = run(command, args);
      if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed (${result.status}).`);
      }
    }
  }
}
