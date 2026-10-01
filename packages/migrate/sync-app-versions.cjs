/**
 * Moves the `@ng-native/*` packages every `package.json` in the workspace lists to this release.
 *
 * `nx migrate` and `ng update` move the root `package.json`'s, through the package group, and no
 * others. An app's own `package.json` lists the same packages: Expo links the native modules it
 * names, and with package-manager workspaces it is what they are installed from. A plain Expo app
 * has only the one, which `ng-native-migrate` moves through this too.
 *
 * A range keeps its `^` or `~`. Anything that is not a version, such as `workspace:*` or `file:`,
 * stays, and so do peer ranges, which say what a library accepts rather than what it installs.
 */
const semver = require('semver');
const { files } = require('./host.cjs');
const { version } = require('./package.json');

/** @param {Record<string, string> | undefined} dependencies */
function moved(dependencies) {
  if (!dependencies) return dependencies;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => {
      // An exact version, or one behind a `^` or `~`, with any prerelease or build suffix SemVer
      // allows. A compound range, a tag or a link is not a version to move.
      const [, prefix = '', exact = ''] = /^([~^]?)(.*)$/.exec(range) ?? [];
      const moves = name.startsWith('@ng-native/') && semver.valid(exact) !== null;
      return [name, moves ? prefix + version : range];
    }),
  );
}

/** A `package.json`'s contents, or null for one that is not JSON, such as a generator's template. */
function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * `manifest` written the way `original` was: its indentation (tabs, or however many spaces), its
 * line endings, and a final newline only if it had one.
 */
function formatted(manifest, original) {
  const indent = /^[ \t]+(?=")/m.exec(original)?.[0] ?? '  ';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(manifest, null, indent).replace(/\n/g, newline);
  return /\r?\n$/.test(original) ? text + newline : text;
}

/** The package manager whose lockfile the workspace has. */
function packageManager(host) {
  const lockfiles = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lock': 'bun',
    'bun.lockb': 'bun',
  };
  return Object.entries(lockfiles).find(([file]) => host.read(file) !== null)?.[1] ?? 'npm';
}

/**
 * @param {import('./host.cjs').Host} host
 * @returns {string[]} the install to run, when a version moved
 */
function syncAppVersions(host) {
  let changed = false;
  for (const file of files(host)) {
    if (file !== 'package.json' && !file.endsWith('/package.json')) continue;
    const manifest = parsed(host.read(file) ?? '');
    if (!manifest) continue;
    const before = JSON.stringify(manifest);
    for (const field of ['dependencies', 'devDependencies']) {
      if (manifest[field]) manifest[field] = moved(manifest[field]);
    }
    if (JSON.stringify(manifest) === before) continue;
    host.write(file, formatted(manifest, host.read(file) ?? ''));
    changed = true;
  }
  if (!changed) return [];
  return [
    `Run ${packageManager(host)} install to install the @ng-native versions the projects now list.`,
  ];
}

module.exports = { syncAppVersions };
