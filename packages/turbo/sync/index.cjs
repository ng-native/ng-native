/**
 * `turbo gen ng-native-sync`, and `ng-native-turbo sync`: lists in each Angular Native app's
 * `package.json` the native modules its workspace libraries use, and adds their config plugins to
 * its `app.json`.
 *
 * Expo's autolinking finds a native module through the libraries, as it walks the app's
 * dependencies. What it does not do is apply the module's config plugin, which Expo takes from
 * `app.json` alone: a camera module whose plugin writes the iOS usage description builds, and
 * stops the app when it asks for the camera. And `expo install --check` checks the versions of
 * the app's own dependencies only, so a module listed there is held to the Expo SDK's version.
 *
 * `@ng-native/nx` reads what a library imports from Nx's project graph; a Turborepo workspace has
 * none, so this reads the library's `package.json`, whose `dependencies`, `optionalDependencies`
 * and `peerDependencies` are what it can import: pnpm links nothing else. A native module counts
 * through any chain of required peers, as `@ng-native/icons` peers on `react-native-svg`.
 *
 * It only adds. A module the app lists stays listed when no library needs it any more, since the
 * app may use it itself. `--check` reports what it would add and changes nothing, for CI.
 */
const nodePath = require('node:path');
const nativeModules = require('@ng-native/migrate/native-modules.cjs');
const { workspacePackages, runtimeDependencies, listed, isNativeApp } = require('../workspace.cjs');

/** @typedef {ReturnType<typeof import('../files.cjs').workspaceFiles>} Files */
/** @typedef {import('../workspace.cjs').WorkspacePackage} WorkspacePackage */

/** The installed packages, beyond the workspace's own files. Replaced in tests. */
const installed = {
  /** @type {typeof nativeModules.installed} */
  find: (pkg, from) => nativeModules.installed(pkg, from),
  /** @type {typeof nativeModules.autoPlugins} */
  autoPlugins: (from) => nativeModules.autoPlugins(from),
};

/**
 * `spec` as the package at `to` writes it, where the package at `from` wrote it: a relative
 * `file:`, `link:` or `portal:` path is resolved from the directory of the `package.json` it is
 * in, so one copied unchanged to another package names another directory.
 *
 * @param {string} spec
 * @param {string} from the directory of the manifest it came from, from the workspace root
 * @param {string} to the app's directory, from the workspace root
 */
function rebase(spec, from, to) {
  const local = /^(file|link|portal):(?!\/|[A-Za-z]:[\\/]|~)(.*)$/.exec(spec);
  if (!local) return spec;
  // From a root of `/`, so the result never depends on the directory this runs in.
  const target = nodePath.posix.join('/', from, local[2]);
  const relative = nodePath.posix.relative(nodePath.posix.join('/', to), target) || '.';
  return `${local[1]}:${relative.startsWith('.') ? relative : `./${relative}`}`;
}

/**
 * The workspace packages `app` depends on, directly or through another, as its manifests list them.
 *
 * @param {WorkspacePackage} app
 * @param {Map<string, WorkspacePackage>} byName
 * @returns {WorkspacePackage[]}
 */
function librariesOf(app, byName) {
  /** @type {Map<string, WorkspacePackage>} */
  const found = new Map();
  const visit = (pkg, all) => {
    for (const name of Object.keys(
      all ? listed(pkg.manifest) : runtimeDependencies(pkg.manifest),
    )) {
      const library = byName.get(name);
      if (!library || library === app || found.has(name)) continue;
      found.set(name, library);
      visit(library, false);
    }
  };
  // Every dependency of the app, its dev dependencies included: an app lists a library it bundles
  // wherever it likes. A library's dev dependencies are its tests' and are not followed.
  visit(app, true);
  return [...found.values()];
}

/**
 * The native modules `app` needs for its libraries, each with the library that brings it in, the
 * range to list and whether it has a config plugin.
 *
 * @param {Files} files
 * @param {WorkspacePackage} app
 * @param {Map<string, WorkspacePackage>} byName
 */
function needed(files, app, byName) {
  const root = listed(files.readJson('package.json') ?? {});
  /** @type {Map<string, { library: string, via?: string, range: string, plugin: boolean }>} */
  const modules = new Map();
  for (const library of librariesOf(app, byName)) {
    const from = nodePath.join(files.root, library.dir);
    // What the library installs, never what it peers on: a peer range says what it accepts, often
    // `*`, and an app listing `*` would install the newest release rather than its Expo SDK's.
    const own = {
      ...library.manifest.devDependencies,
      ...library.manifest.optionalDependencies,
      ...library.manifest.dependencies,
    };
    const add = (pkg, info, via) => {
      if (!info?.native || modules.has(pkg)) return;
      const range =
        (root[pkg] && rebase(root[pkg], '', app.dir)) ??
        (own[pkg] && rebase(own[pkg], library.dir, app.dir)) ??
        info.version;
      modules.set(pkg, { library: library.dir, via, range, plugin: info.plugin });
    };
    // Each package and, through a visited set, the required peers of each package found, at any
    // depth: a module a peer peers on is as missing as the peer.
    const seen = new Set();
    const visit = (pkg, dir, via) => {
      if (seen.has(pkg)) return;
      seen.add(pkg);
      const info = installed.find(pkg, dir);
      add(pkg, info, via);
      for (const peer of info?.peers ?? []) visit(peer, info.dir, via ?? pkg);
    };
    for (const pkg of Object.keys(runtimeDependencies(library.manifest))) {
      if (!byName.has(pkg)) visit(pkg, from, undefined);
    }
  }
  return modules;
}

/**
 * @param {Files} files
 * @param {{ check?: boolean }} [options] with `check`, report what is missing and write nothing
 * @returns {Promise<{ changes: string[] }>} a sentence for each module or plugin an app lacked
 */
async function sync(files, options = {}) {
  const packages = workspacePackages(files);
  const byName = new Map(
    packages.filter((pkg) => pkg.manifest.name).map((pkg) => [pkg.manifest.name, pkg]),
  );
  /** @type {string[]} */
  const changes = [];
  for (const app of packages.filter((pkg) => isNativeApp(files, pkg))) {
    const has = listed(app.manifest);
    const all = [...needed(files, app, byName)];
    const missing = all.filter(([pkg]) => !(pkg in has));
    for (const [pkg, { library, via }] of missing) {
      const reason = via ? `${library} uses ${via}, which needs it` : `${library} uses it`;
      changes.push(`${app.dir}/package.json needs ${pkg}: ${reason}.`);
    }
    if (missing.length && !options.check) {
      files.updateJson(`${app.dir}/package.json`, (manifest) => {
        manifest.dependencies = { ...manifest.dependencies };
        for (const [pkg, { range }] of missing) manifest.dependencies[pkg] = range;
        return manifest;
      });
    }

    const appJson = `${app.dir}/app.json`;
    const auto = new Set(installed.autoPlugins(nodePath.join(files.root, app.dir)));
    const present = nativeModules.pluginNames(files.readJson(appJson)?.expo?.plugins);
    const plugins = all
      .filter(([pkg, { plugin }]) => plugin && !auto.has(pkg) && !present.includes(pkg))
      .map(([pkg]) => pkg);
    for (const pkg of plugins) changes.push(`${appJson} needs the config plugin of ${pkg}.`);
    if (plugins.length && !options.check) {
      files.updateJson(appJson, (config) => {
        config.expo ??= {};
        config.expo.plugins = [...(config.expo.plugins ?? []), ...plugins];
        return config;
      });
    }
  }
  return { changes };
}

module.exports = { sync, installed, librariesOf };
