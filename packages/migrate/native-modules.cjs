/**
 * Which installed packages are native modules, for the generators that list them in an app's
 * `package.json`: `@ng-native/nx`'s `sync-native-modules` and `@ng-native/turbo`'s `sync`.
 *
 * Each generator says why an app lists them: Expo applies a module's config plugin only from the
 * app's `app.json`, and links a module a library reaches only through the app's dependency tree. A
 * native module is a package with an Expo module config or a native project of its own, as Expo's
 * autolinking finds them. A package that peers on one without marking the peer optional needs it too, as
 * `@ng-native/icons` does `react-native-svg`.
 */
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const nodePath = require('node:path');

/** Whether the package in `dir` has native code Expo's autolinking links. */
function isNativeModule(dir) {
  if (existsSync(nodePath.join(dir, 'expo-module.config.json'))) return true;
  if (readdirSync(dir).some((file) => file.endsWith('.podspec'))) return true;
  return ['build.gradle', 'build.gradle.kts'].some((file) =>
    existsSync(nodePath.join(dir, 'android', file)),
  );
}

/** The directory `pkg` is installed in, as Node resolves it from `from`. */
function packageDir(pkg, from) {
  try {
    return nodePath.dirname(require.resolve(`${pkg}/package.json`, { paths: [from] }));
  } catch {
    // A package whose exports leave out its package.json: up from its entry point.
  }
  let dir;
  try {
    dir = nodePath.dirname(require.resolve(pkg, { paths: [from] }));
  } catch {
    return undefined;
  }
  for (; dir !== nodePath.dirname(dir); dir = nodePath.dirname(dir)) {
    const manifest = nodePath.join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === pkg) return dir;
  }
  return undefined;
}

/**
 * What `pkg`, resolved from the directory `from`, is to an app, or undefined when it is not
 * installed.
 *
 * @param {string} pkg
 * @param {string} from
 * @returns {{ version: string, native: boolean, plugin: boolean, peers: string[], dir: string } | undefined}
 */
function installed(pkg, from) {
  const dir = packageDir(pkg, from);
  if (!dir) return undefined;
  const manifest = JSON.parse(readFileSync(nodePath.join(dir, 'package.json'), 'utf8'));
  const meta = manifest.peerDependenciesMeta ?? {};
  return {
    version: manifest.version,
    native: isNativeModule(dir),
    plugin: existsSync(nodePath.join(dir, 'app.plugin.js')),
    peers: Object.keys(manifest.peerDependencies ?? {}).filter((peer) => !meta[peer]?.optional),
    dir,
  };
}

/**
 * The config plugins Expo applies whether an app lists them or not, as `expo install` skips, for
 * the app in the directory `from`.
 *
 * @param {string} from
 * @returns {string[]}
 */
function autoPlugins(from) {
  try {
    const expo = packageDir('expo', from);
    const config = require(require.resolve('@expo/prebuild-config', { paths: [expo ?? from] }));
    return config.getAutoPlugins();
  } catch {
    return [];
  }
}

/** The names in an `app.json`'s `plugins`, each a name or a `[name, options]` pair. */
function pluginNames(plugins) {
  return (plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

module.exports = { isNativeModule, packageDir, installed, autoPlugins, pluginNames };
