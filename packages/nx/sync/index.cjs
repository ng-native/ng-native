/**
 * `@ng-native/nx:sync-native-modules`: lists in each Angular Native app's `package.json` the native
 * modules the workspace libraries it uses import, and adds their config plugins to its `app.json`.
 *
 * Expo links only the native modules an app's own `package.json` names. Expo Go contains every
 * module in the SDK, so an app whose library imports one the app does not list works there and
 * fails in a development or release build. A library cannot declare what it needs of an app, but
 * Nx's project graph records what each one imports, so this reads it from there.
 *
 * It is a sync generator: the app generator registers it on the app's `start`, `export` and
 * `prebuild` targets, so Nx runs it before them, and `nx sync:check` fails a CI run it would
 * change. It only adds. A module the app lists stays listed when no library imports it any more,
 * since the app may use it itself.
 *
 * A native module is a package with an Expo module config or a native project of its own, as
 * Expo's autolinking finds them. It counts when a library imports it, and when a package a
 * library imports peers on it without marking the peer optional, as `@ng-native/icons` does on
 * `react-native-svg`.
 */
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const nodePath = require('node:path');
const {
  createProjectGraphAsync,
  formatFiles,
  getProjects,
  joinPathFragments,
  readJson,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
} = require('@nx/devkit');

const SYNC_GENERATOR = '@ng-native/nx:sync-native-modules';

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

/** The workspace beyond the tree: its project graph and its installed packages. Replaced in tests. */
const workspace = {
  graph: () => createProjectGraphAsync(),

  /**
   * What `pkg`, resolved from the directory `from`, is to an app, or undefined when it is not
   * installed.
   *
   * @param {string} pkg
   * @param {string} from
   * @returns {{ version: string, native: boolean, plugin: boolean, peers: string[], dir: string } | undefined}
   */
  installed(pkg, from) {
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
  },

  /** The config plugins Expo applies whether an app lists them or not, as `expo install` skips. */
  autoPlugins(from) {
    try {
      const expo = packageDir('expo', from);
      const config = require(require.resolve('@expo/prebuild-config', { paths: [expo ?? from] }));
      return config.getAutoPlugins();
    } catch {
      return [];
    }
  },
};

/** The projects the app `name` depends on, directly or through another, in the graph. */
function librariesOf(graph, name) {
  const found = new Set();
  const visit = (project) => {
    for (const { target } of graph.dependencies[project] ?? []) {
      if (!graph.nodes[target] || found.has(target) || target === name) continue;
      found.add(target);
      visit(target);
    }
  };
  visit(name);
  return [...found];
}

/** The packages a project imports, by name. */
function importsOf(graph, project) {
  return (graph.dependencies[project] ?? [])
    .map(({ target }) => graph.externalNodes?.[target]?.data?.packageName)
    .filter(Boolean);
}

/** Whether the project is an Angular Native app: an Expo app that runs on `@ng-native/platform`. */
function isNativeApp(tree, root) {
  const manifest = joinPathFragments(root, 'package.json');
  if (!tree.exists(joinPathFragments(root, 'app.json')) || !tree.exists(manifest)) return false;
  const { dependencies, devDependencies } = readJson(tree, manifest);
  return Boolean({ ...dependencies, ...devDependencies }['@ng-native/platform']);
}

function listed(manifest) {
  return { ...manifest.devDependencies, ...manifest.dependencies };
}

/**
 * The native modules the app `name` needs for its libraries, each with the library that brings it
 * in, the range to list and whether it has a config plugin.
 */
function needed(tree, graph, name) {
  const root = listed(readJson(tree, 'package.json'));
  const modules = new Map();
  for (const library of librariesOf(graph, name)) {
    const libraryRoot = graph.nodes[library].data.root;
    const from = nodePath.join(tree.root, libraryRoot);
    const manifest = joinPathFragments(libraryRoot, 'package.json');
    const own = tree.exists(manifest) ? listed(readJson(tree, manifest)) : {};
    const add = (pkg, info, via) => {
      if (!info?.native || modules.has(pkg)) return;
      const range = root[pkg] ?? own[pkg] ?? info.version;
      modules.set(pkg, { library: libraryRoot, via, range, plugin: info.plugin });
    };
    for (const pkg of importsOf(graph, library)) {
      const info = workspace.installed(pkg, from);
      add(pkg, info);
      for (const peer of info?.peers ?? []) add(peer, workspace.installed(peer, info.dir), pkg);
    }
  }
  return modules;
}

/** The names in an `app.json`'s `plugins`, each a name or a `[name, options]` pair. */
function pluginNames(plugins) {
  return (plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @returns {Promise<{ outOfSyncMessage?: string, outOfSyncDetails?: string[] }>}
 */
async function syncNativeModules(tree) {
  const graph = await workspace.graph();
  const details = [];
  for (const [name, project] of getProjects(tree)) {
    if (!isNativeApp(tree, project.root) || !graph.nodes[name]) continue;
    const manifestPath = joinPathFragments(project.root, 'package.json');
    const has = listed(readJson(tree, manifestPath));
    const all = [...needed(tree, graph, name)];
    const modules = all.filter(([pkg]) => !(pkg in has));
    if (modules.length > 0) {
      updateJson(tree, manifestPath, (manifest) => {
        manifest.dependencies ??= {};
        for (const [pkg, { range }] of modules) manifest.dependencies[pkg] = range;
        return manifest;
      });
    }
    for (const [pkg, { library, via }] of modules) {
      const reason = via ? `${library} imports ${via}, which needs it` : `${library} imports it`;
      details.push(`${project.root}/package.json needs ${pkg}: ${reason}.`);
    }

    const appJson = joinPathFragments(project.root, 'app.json');
    const auto = new Set(workspace.autoPlugins(nodePath.join(tree.root, project.root)));
    const plugins = all.filter(([pkg, { plugin }]) => plugin && !auto.has(pkg)).map(([pkg]) => pkg);
    const present = pluginNames(readJson(tree, appJson).expo?.plugins);
    const missing = plugins.filter((pkg) => !present.includes(pkg));
    if (missing.length > 0) {
      updateJson(tree, appJson, (config) => {
        config.expo ??= {};
        config.expo.plugins = [...(config.expo.plugins ?? []), ...missing];
        return config;
      });
      for (const pkg of missing) details.push(`${appJson} needs the config plugin of ${pkg}.`);
    }
  }
  if (details.length === 0) return {};
  // As the app generator wrote them, rather than as JSON.stringify does.
  await formatFiles(tree);
  return {
    outOfSyncMessage:
      'An app does not list a native module its libraries import, so a development build would not link it.',
    outOfSyncDetails: details,
  };
}

/**
 * Registers the sync generator on the app's `start`, `export` and `prebuild` targets. `export` and
 * `prebuild` are `@nx/expo`'s, inferred, and take the option from `project.json` beside the rest.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} projectName
 */
function registerSyncGenerator(tree, projectName) {
  const project = readProjectConfiguration(tree, projectName);
  const targets = { ...project.targets };
  for (const target of ['start', 'export', 'prebuild']) {
    const syncGenerators = targets[target]?.syncGenerators ?? [];
    if (syncGenerators.includes(SYNC_GENERATOR)) continue;
    targets[target] = { ...targets[target], syncGenerators: [...syncGenerators, SYNC_GENERATOR] };
  }
  updateProjectConfiguration(tree, projectName, { ...project, targets });
}

module.exports = { syncNativeModules, registerSyncGenerator, workspace, SYNC_GENERATOR };
