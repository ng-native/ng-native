/**
 * `@ng-native/nx:sync-native-modules`: lists in each Angular Native app's `package.json` the native
 * modules the workspace libraries it uses import, and adds their config plugins to its `app.json`.
 *
 * Expo's autolinking links the native modules in the app's dependency tree: the packages its
 * `package.json` lists, and the `dependencies` and required `peerDependencies` of each in turn. A
 * library the app imports through a tsconfig path alias, as an integrated workspace's are, is not in
 * that tree, so a native module it imports is linked only if something in the tree brings it in,
 * the app listing it or another dependency of the app. Otherwise an SDK module still works in Expo
 * Go, which has the SDK's modules built in, and a development or release build has no native code
 * for it. A library that is a workspace package the app lists is walked, and the modules it depends
 * on or requires as peers are linked. Either way Expo applies a module's config plugin only when
 * `app.json` names it, apart from the few in `getAutoPlugins()`, and `expo install --check` checks
 * the versions of the app's own dependencies only. A library cannot declare what it needs of an
 * app, but Nx's project graph records what each one imports, so this reads it from there.
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
const nativeModules = require('@ng-native/migrate/native-modules.cjs');

const SYNC_GENERATOR = '@ng-native/nx:sync-native-modules';

/** The workspace beyond the tree: its project graph and its installed packages. Replaced in tests. */
const workspace = {
  graph: () => createProjectGraphAsync(),
  /** @type {typeof nativeModules.installed} */
  installed: (pkg, from) => nativeModules.installed(pkg, from),
  /** @type {typeof nativeModules.autoPlugins} */
  autoPlugins: (from) => nativeModules.autoPlugins(from),
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
    const present = nativeModules.pluginNames(readJson(tree, appJson).expo?.plugins);
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
      'An app does not list a native module its libraries import, or its config plugin in app.json.',
    outOfSyncDetails: details,
  };
}

/**
 * Registers the sync generator on the app's `start`, `export` and `prebuild` targets. `export` and
 * `prebuild` are `@nx/expo`'s, inferred, and take the option from `project.json` beside the rest.
 * A desktop-only app, which the plugin is kept off, has no `prebuild` to take it.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} projectName
 * @param {readonly string[]} [names] the targets
 */
function registerSyncGenerator(tree, projectName, names = ['start', 'export', 'prebuild']) {
  const project = readProjectConfiguration(tree, projectName);
  const targets = { ...project.targets };
  const missing = names.filter(
    (target) => !targets[target]?.syncGenerators?.includes(SYNC_GENERATOR),
  );
  if (!missing.length) return;
  for (const target of missing) {
    const syncGenerators = targets[target]?.syncGenerators ?? [];
    targets[target] = { ...targets[target], syncGenerators: [...syncGenerators, SYNC_GENERATOR] };
  }
  updateProjectConfiguration(tree, projectName, { ...project, targets });
}

module.exports = { syncNativeModules, registerSyncGenerator, workspace, SYNC_GENERATOR };
