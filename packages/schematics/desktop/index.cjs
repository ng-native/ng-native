/**
 * `ng generate @ng-native/schematics:desktop native`: an Angular Native app that runs on macOS and
 * Linux too.
 *
 * The project's `app.json` lists `macos` and `linux` with Expo's `experiments.outOfTreePlatforms`
 * (without it Expo drops them from every bundle and export, and says nothing) and the
 * `@ng-native/desktop` config plugin. The workspace depends on `@ng-native/desktop`, and the
 * project gains targets on the `expo` builder: `ng run native:macos` and `ng run native:linux`
 * build the desktop host and open the app from the dev server `ng serve native` runs, and
 * `ng run native:package` makes the `.app`, `.dmg` or Mac App Store package, or on Linux the app
 * folder, `.deb`, `.rpm` or Flatpak.
 *
 * It only adds, so running it again changes nothing, and a project that has `macos` alone gains
 * `linux`.
 */
const path = require('node:path').posix;
const { workspaces } = require('@angular-devkit/core');
const { SchematicsException } = require('@angular-devkit/schematics');
const { NodePackageInstallTask } = require('@angular-devkit/schematics/tasks');
const native = require('../native-app.cjs');

function readJson(tree, file) {
  return JSON.parse(tree.readText(file));
}

/** Writes `value` as JSON, only where it differs from what is there. */
function writeJson(tree, file, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (!tree.exists(file)) tree.create(file, text);
  else if (tree.readText(file) !== text) tree.overwrite(file, text);
}

/**
 * The port the project's `serve` target runs Metro on, from its `port` option or a `--port` in its
 * `args`, or undefined for Expo's default. The `macos` and `linux` targets load the app from it.
 */
function servePort(project) {
  const serve = project?.targets.get('serve');
  // Angular lays each default configuration's options over the target's own, in order, a later
  // value replacing an earlier one whole.
  const names = (serve?.defaultConfiguration ?? '').split(',').map((name) => name.trim());
  const layers = names.filter(Boolean).map((name) => serve.configurations?.[name] ?? {});
  return portOf(Object.assign({}, serve?.options, ...layers));
}

/** The port a set of `serve` options names, as `port` or as `--port` in `args`. */
function portOf(options = {}) {
  if (typeof options.port === 'number') return options.port;
  const args = Array.isArray(options.args) ? options.args.map(String) : [];
  const at = args.findIndex((arg) => arg === '--port' || arg.startsWith('--port='));
  if (at < 0) return undefined;
  const value = args[at].includes('=') ? args[at].split('=')[1] : args[at + 1];
  return /^\d+$/.test(value ?? '') ? Number(value) : undefined;
}

/**
 * The targets, each on the `expo` builder, which runs `ng-native-desktop` for them. `macos` and
 * `linux` take the `serve` target's port, so the host loads from the dev server `ng serve` runs.
 */
function desktopTargets(port) {
  const desktop = (command, extra) => ({
    builder: '@ng-native/schematics:expo',
    options: { command, ...extra },
  });
  return {
    ...Object.fromEntries(native.DESKTOP_OSES.map((os) => [os, desktop(os, port ? { port } : {})])),
    package: desktop('package'),
  };
}

/** The project's `app.json` with `withOs` applied to its Expo config. */
function updateAppJson(tree, file, withOs) {
  const config = readJson(tree, file);
  writeJson(tree, file, { ...config, expo: withOs(config.expo ?? {}) });
}

/**
 * `angular.json` as the Angular CLI reads it, comments and trailing commas allowed, and written
 * back with them kept: Angular's own workspace reader and writer, over the schematic's tree.
 */
function workspaceHost(tree) {
  return {
    readFile: async (file) => tree.readText(file),
    writeFile: async (file, data) => tree.overwrite(file, data),
    isDirectory: async (dir) => !tree.exists(dir) && tree.getDir(dir).subfiles.length > 0,
    isFile: async (file) => tree.exists(file),
  };
}

/** Each of `wanted` the manifest at `file` lacks, added to its dependencies. */
function addDependencies(tree, file, wanted) {
  if (!tree.exists(file)) return;
  const manifest = readJson(tree, file);
  const existing = { ...manifest.dependencies, ...manifest.devDependencies };
  const added = Object.entries(wanted).filter(([name]) => !(name in existing));
  if (!added.length) return;
  manifest.dependencies = Object.fromEntries(
    [...Object.entries(manifest.dependencies ?? {}), ...added].sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeJson(tree, file, manifest);
}

/** The lines of `native.DESKTOP_GITIGNORE` the project's `.gitignore` lacks, appended. */
function ignorePackages(tree, root) {
  const file = path.join(root, '.gitignore');
  const ignore = tree.exists(file) ? tree.readText(file) : '';
  const rules = native.DESKTOP_GITIGNORE.split('\n').filter(
    (line) => line && !line.startsWith('#'),
  );
  if (rules.every((rule) => ignore.split('\n').includes(rule))) return;
  const separator = ignore === '' ? '' : ignore.endsWith('\n') ? '\n' : '\n\n';
  const text = `${ignore}${separator}${native.DESKTOP_GITIGNORE}`;
  if (tree.exists(file)) tree.overwrite(file, text);
  else tree.create(file, text);
}

/**
 * @param {{ project: string, skipInstall?: boolean }} options
 */
function desktop(options) {
  return async (tree, context) => {
    if (!tree.exists('angular.json')) {
      throw new SchematicsException('No angular.json here. Run this in an Angular CLI workspace.');
    }
    const host = workspaceHost(tree);
    const { workspace } = await workspaces.readWorkspace(
      'angular.json',
      host,
      workspaces.WorkspaceFormat.JSON,
    );
    const project = workspace.projects.get(options.project);
    if (!project) {
      throw new SchematicsException(`angular.json has no project called "${options.project}".`);
    }
    const root = project.root ?? '';
    const appJson = path.join(root, 'app.json');
    if (!tree.exists(appJson)) {
      throw new SchematicsException(
        `${options.project} is not an Angular Native app: it has no ${appJson}. Make one with ` +
          'ng add @ng-native/schematics, or ng generate @ng-native/schematics:application.',
      );
    }
    updateAppJson(tree, appJson, native.withDesktop);
    addDependencies(tree, 'package.json', native.desktopDependencies);
    ignorePackages(tree, root);
    const missing = Object.entries(desktopTargets(servePort(project))).filter(
      ([name]) => !project.targets.has(name),
    );
    for (const [name, target] of missing) project.targets.add({ name, ...target });
    if (missing.length) await workspaces.writeWorkspace(workspace, host);

    if (!options.skipInstall) context.addTask(new NodePackageInstallTask());
    context.logger.info(
      `${options.project} runs on macOS and Linux: ng serve ${options.project}, then ` +
        `ng run ${options.project}:macos or ng run ${options.project}:linux. ` +
        `ng run ${options.project}:package makes the app.`,
    );
  };
}

module.exports = {
  desktop,
  desktopTargets,
  servePort,
  workspaceHost,
  updateAppJson,
  addDependencies,
};
