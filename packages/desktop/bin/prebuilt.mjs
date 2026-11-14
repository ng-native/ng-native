/**
 * Prebuilt desktop hosts: the signed, universal Release host each release publishes per React
 * Native version, so an app with no native desktop code of its own compiles nothing.
 *
 * `prebuilt.json` beside this package lists them. The release workflow writes it before the
 * package is packed, so the SHA-256 of each archive travels inside the npm package, not beside the
 * archive it vouches for. An archive holds `appkit/ngn-macos`, `appkit/hermesc` and
 * `appkit/Sparkle.framework`, the files a host build's `appkit` folder has, and unpacks into the
 * per-user cache under its own hash, so a new archive never reuses an old one's files.
 *
 * `native/scripts/make-prebuilt.mjs` builds and packs one.
 */
import path from 'node:path';

/** The manifest's format, which `prebuilt.json` names. */
export const MANIFEST_VERSION = 1;

/**
 * @typedef {{ reactNative: string, url: string, sha256: string, libraries: Record<string, string> }} PrebuiltHost
 * @typedef {{ version: number, hosts: PrebuiltHost[] }} PrebuiltManifest
 * @typedef {import('./host.mjs').system} System
 */

/**
 * The archive's file name for a release of this package and a React Native version.
 *
 * @param {string} desktopVersion
 * @param {string} reactNative
 */
export function prebuiltName(desktopVersion, reactNative) {
  return `ng-native-desktop-host-${desktopVersion}-rn-${reactNative}-macos-universal.tar.gz`;
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
 * `manifest` with `host` in it, in place of the one for the same React Native version.
 *
 * @param {PrebuiltManifest} manifest
 * @param {PrebuiltHost} host
 * @returns {PrebuiltManifest}
 */
export function withHost(manifest, host) {
  const hosts = manifest.hosts.filter((each) => each.reactNative !== host.reactNative);
  return { version: MANIFEST_VERSION, hosts: [...hosts, host] };
}

/**
 * The prebuilt host an app can run on, or why it builds its own: one is used only for the app's
 * React Native version, when the app links no native desktop code, and when each host library it
 * has is the version the host was built with and is not denied.
 *
 * @param {PrebuiltManifest} manifest
 * @param {{ reactNative: string, linked: number, libraries: Record<string, string | null>, deny: readonly string[], env: Record<string, string | undefined> }} app
 *   `libraries` holds each host library's installed version, or null where the app lacks it
 * @returns {{ host: PrebuiltHost } | { reason: string }}
 */
export function choosePrebuilt(manifest, { reactNative, linked, libraries, deny, env }) {
  if (env['NGN_DESKTOP_FROM_SOURCE'] === '1') return { reason: 'NGN_DESKTOP_FROM_SOURCE=1' };
  if (linked > 0) return { reason: 'the app links native desktop code' };
  const host = manifest.hosts.find((each) => each.reactNative === reactNative);
  if (!host) return { reason: `no prebuilt host for React Native ${reactNative}` };
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
 * source instead; a download whose SHA-256 is not the manifest's throws, and is deleted.
 *
 * @param {System} sys
 * @param {PrebuiltHost} host
 * @param {string} cache the React Native version's folder in the per-user cache
 * @returns {string | null}
 */
export function fetchPrebuilt(sys, host, cache) {
  if (!/^[0-9a-f]{64}$/.test(host.sha256)) {
    throw new Error(`prebuilt.json gives React Native ${host.reactNative} no SHA-256 to check.`);
  }
  const dir = path.join(cache, 'prebuilt', host.sha256.slice(0, 16));
  if (sys.exists(path.join(dir, 'appkit', 'ngn-macos'))) return dir;
  const archive = `${dir}.tar.gz`;
  const unpacked = `${dir}.partial`;
  sys.remove(archive);
  sys.remove(unpacked);
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
  sys.remove(dir);
  sys.rename(unpacked, dir);
  return dir;
}
