/**
 * Moves the `@ng-native/*` packages every project's own `package.json` lists to this package's
 * version, which `ng update` has just installed.
 *
 * `ng update` moves the root `package.json`'s, through this package's `packageGroup`, and no
 * others. The native project's own `package.json` names the same packages for Expo, which links the
 * native modules it lists and reads their versions on `expo prebuild`. `migrations.json` registers
 * this at this package's version, which the release moves to each new one, so every update crosses
 * it and runs it.
 *
 * A range keeps its `^` or `~`. Anything that is not a version, such as `file:`, stays, and so do
 * peer ranges.
 */
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

function syncAppVersions() {
  return (tree) => {
    const { projects = {} } = JSON.parse(tree.readText('angular.json'));
    const roots = Object.values(projects).map(({ root }) => (root ? `${root}/` : ''));
    for (const file of new Set(['package.json', ...roots.map((root) => `${root}package.json`)])) {
      if (!tree.exists(file)) continue;
      const manifest = JSON.parse(tree.readText(file));
      const before = JSON.stringify(manifest);
      for (const field of ['dependencies', 'devDependencies']) {
        if (manifest[field]) manifest[field] = moved(manifest[field]);
      }
      if (JSON.stringify(manifest) === before) continue;
      tree.overwrite(file, JSON.stringify(manifest, null, 2) + '\n');
    }
  };
}

module.exports = { syncAppVersions };
