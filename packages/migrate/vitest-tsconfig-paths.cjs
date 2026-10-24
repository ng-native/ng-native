/**
 * `@ng-native/nx` wrote `nxViteTsPaths()` from `@nx/vite` into the Vitest config of an app or
 * library in a workspace with tsconfig path aliases. From Nx 24 that export is an inert stub, so a
 * test importing one of the workspace's libraries failed with "Cannot find package '@org/ui'". The
 * generators now write `vite-tsconfig-paths`, as Nx 24 does in its own Vite configs.
 *
 * Each `vitest.config.mts` that runs `ngNative()` and imports `nxViteTsPaths` from `@nx/vite`
 * imports `tsconfigPaths` from `vite-tsconfig-paths` in its place, and the root `package.json`
 * gains `vite-tsconfig-paths` when it lists neither. A config the generator did not write is left
 * as it is.
 */
const { files } = require('./host.cjs');
const { formatted } = require('./sync-app-versions.cjs');

// Either quote, as the workspace's Prettier formats it.
const FROM =
  /import \{ nxViteTsPaths \} from (['"])@nx\/vite\/plugins\/nx-tsconfig-paths\.plugin\1;/;
const TO = 'import tsconfigPaths from $1vite-tsconfig-paths$1;';
const DEPENDENCY = { name: 'vite-tsconfig-paths', range: '^5.1.4' };

/**
 * Rewrites each config the generators wrote, and answers whether there was one.
 *
 * @param {import('./host.cjs').Host} host
 */
function rewriteConfigs(host) {
  let changed = false;
  for (const file of files(host)) {
    if (file !== 'vitest.config.mts' && !file.endsWith('/vitest.config.mts')) continue;
    const text = host.read(file) ?? '';
    if (!FROM.test(text) || !text.includes('@ng-native/testing/vitest')) continue;
    host.write(file, text.replace(FROM, TO).replace(/\bnxViteTsPaths\(\)/g, 'tsconfigPaths()'));
    changed = true;
  }
  return changed;
}

/** @param {import('./host.cjs').Host} host */
function vitestTsconfigPaths(host) {
  const original = rewriteConfigs(host) ? host.read('package.json') : null;
  if (original === null) return [];
  const manifest = JSON.parse(original);
  if (manifest.dependencies?.[DEPENDENCY.name] || manifest.devDependencies?.[DEPENDENCY.name]) {
    return [];
  }
  manifest.devDependencies = { ...manifest.devDependencies, [DEPENDENCY.name]: DEPENDENCY.range };
  host.write('package.json', formatted(manifest, original));
  return ['Install vite-tsconfig-paths, which the root package.json now lists.'];
}

module.exports = { vitestTsconfigPaths };
