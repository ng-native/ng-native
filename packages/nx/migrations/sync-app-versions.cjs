/**
 * Moves the `@ng-native/*` packages every project's own `package.json` lists to this package's
 * version, which the upgrade has just installed.
 *
 * `nx migrate` moves the root `package.json`'s, through this package's `packageGroup`, and no
 * others. With package-manager workspaces an app lists its own and is installed from them, so
 * without this an upgraded workspace kept the old ones beside the new root. `migrations.json`
 * registers it at this package's version, which the release moves to each new one, so every upgrade
 * crosses it and runs it.
 *
 * A range keeps its `^` or `~`. Anything that is not a version, such as `workspace:*`, stays, and so
 * do peer ranges, which say what a library accepts rather than what it installs.
 */
const { formatFiles, getProjects, readJson, writeJson } = require('@nx/devkit');
const { version } = require('../package.json');

/** @param {Record<string, string> | undefined} dependencies */
function moved(dependencies) {
  if (!dependencies) return dependencies;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => {
      const prefix = /^([~^]?)\d+\.\d+\.\d+(?:-[\w.]+)?$/.exec(range)?.[1];
      return [
        name,
        name.startsWith('@ng-native/') && prefix !== undefined ? prefix + version : range,
      ];
    }),
  );
}

/** The package manager whose lockfile the workspace has. */
function packageManager(tree) {
  const lockfiles = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'bun.lock': 'bun',
    'bun.lockb': 'bun',
  };
  return Object.entries(lockfiles).find(([file]) => tree.exists(file))?.[1] ?? 'npm';
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @returns {Promise<string[]>} the next step, when there is one: `nx migrate --run-migrations`
 *   installs only when the root `package.json` changed, and prints these.
 */
async function syncAppVersions(tree) {
  const manifests = [
    'package.json',
    ...[...getProjects(tree).values()].map(({ root }) => `${root}/package.json`),
  ];
  let changed = false;
  for (const file of new Set(manifests)) {
    if (!tree.exists(file)) continue;
    const manifest = readJson(tree, file);
    const next = {
      ...manifest,
      ...(manifest.dependencies && { dependencies: moved(manifest.dependencies) }),
      ...(manifest.devDependencies && { devDependencies: moved(manifest.devDependencies) }),
    };
    if (JSON.stringify(next) === JSON.stringify(manifest)) continue;
    writeJson(tree, file, next);
    changed = true;
  }
  if (!changed) return [];
  await formatFiles(tree);
  return [
    `Run ${packageManager(tree)} install to install the @ng-native versions the projects now list.`,
  ];
}

module.exports = { syncAppVersions };
