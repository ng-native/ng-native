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
 *
 * Where the workspace's Vite resolves tsconfig paths itself (Vite 8 and later, with a Vitest that
 * takes it: the same test the generators use), each config gets Vite's `resolve.tsconfigPaths`
 * instead, with no import, and the root `package.json` gains `vite` where it lists none. A config
 * that cannot take the option, one with a `resolve` of its own or the call somewhere other than
 * first in a `plugins` list, gets the plugin as before. A config already on `vite-tsconfig-paths`
 * or on `resolve.tsconfigPaths` no longer matches and is left as it is, so running the migration
 * on a workspace that has had it changes nothing.
 */
const { files } = require('./host.cjs');
const { formatted } = require('./sync-app-versions.cjs');
const { viteResolvesPaths } = require('./native-app.cjs');

// Either quote, as the workspace's Prettier formats it.
const FROM =
  /import \{ nxViteTsPaths \} from (['"])@nx\/vite\/plugins\/nx-tsconfig-paths\.plugin\1;/;
const TO = 'import tsconfigPaths from $1vite-tsconfig-paths$1;';
const PLUGIN = { name: 'vite-tsconfig-paths', range: '^5.1.4' };
const VITE = { name: 'vite', range: '^8.0.0' };
const FIRST_PLUGIN = /plugins: \[nxViteTsPaths\(\), /g;

/** The config with Vite's own option in place of the plugin, or null where it cannot take it. */
function viaVite(text) {
  if (/\bresolve:/.test(text)) return null;
  const next = text
    .replace(new RegExp(`${FROM.source}\\r?\\n?`), '')
    .replace(FIRST_PLUGIN, 'resolve: { tsconfigPaths: true }, plugins: [');
  return next.includes('nxViteTsPaths') ? null : next;
}

/**
 * Rewrites each config the generators wrote, and answers which dependency the root `package.json`
 * needs for the ones it rewrote. `vite` is the one a config that
 * left the aliases to Vite needs; `vite-tsconfig-paths` is the one any other config does.
 *
 * @param {import('./host.cjs').Host} host
 * @param {() => boolean} resolvesPaths whether the workspace's Vite resolves the aliases itself,
 *   asked only once a config needs the answer
 */
function rewriteConfigs(host, resolvesPaths) {
  const needed = new Set();
  for (const file of files(host)) {
    if (file !== 'vitest.config.mts' && !file.endsWith('/vitest.config.mts')) continue;
    const text = host.read(file) ?? '';
    if (!FROM.test(text) || !text.includes('@ng-native/testing/vitest')) continue;
    const native = resolvesPaths() ? viaVite(text) : null;
    host.write(
      file,
      native ?? text.replace(FROM, TO).replace(/\bnxViteTsPaths\(\)/g, 'tsconfigPaths()'),
    );
    needed.add(native === null ? PLUGIN : VITE);
  }
  return needed;
}

/** @param {import('./host.cjs').Host} host */
function vitestTsconfigPaths(host) {
  const original = host.read('package.json');
  // With no manifest to read the Vite from, the plugin works on any Vite.
  const needed = rewriteConfigs(
    host,
    () => original !== null && viteResolvesPaths(JSON.parse(original)),
  );
  if (original === null || needed.size === 0) return [];
  const manifest = JSON.parse(original);
  const added = [...needed].filter(
    ({ name }) => !manifest.dependencies?.[name] && !manifest.devDependencies?.[name],
  );
  if (added.length === 0) return [];
  manifest.devDependencies = {
    ...manifest.devDependencies,
    ...Object.fromEntries(added.map(({ name, range }) => [name, range])),
  };
  host.write('package.json', formatted(manifest, original));
  return added.map(({ name }) => `Install ${name}, which the root package.json now lists.`);
}

module.exports = { vitestTsconfigPaths };
