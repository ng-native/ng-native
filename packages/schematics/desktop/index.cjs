/**
 * `ng generate @ng-native/schematics:desktop native`: an Angular Native app that runs on macOS too.
 *
 * The project's `app.json` lists `macos` with Expo's `experiments.outOfTreePlatforms` (without it
 * Expo drops `macos` from every bundle and export, and says nothing) and the `@ng-native/desktop`
 * config plugin. The workspace depends on `@ng-native/desktop`, and the project gains two targets on
 * the `expo` builder: `ng run native:macos` builds the desktop host and opens the app from the dev
 * server `ng serve native` runs, and `ng run native:package` makes the `.app`, `.dmg` or Mac App
 * Store package.
 *
 * It only adds, so running it again changes nothing.
 */
const path = require('node:path').posix;
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

/** The two targets, each on the `expo` builder, which runs `ng-native-desktop` for them. */
function desktopTargets() {
  const desktop = (command) => ({ builder: '@ng-native/schematics:expo', options: { command } });
  return { macos: desktop('macos'), package: desktop('package') };
}

function addToAppJson(tree, root, context) {
  const file = path.join(root, 'app.json');
  if (!tree.exists(file)) {
    context.logger.warn(
      `Could not update ${file}: it does not exist. Add "macos" to expo.platforms, set ` +
        'expo.experiments.outOfTreePlatforms to true and add "@ng-native/desktop" to expo.plugins.',
    );
    return;
  }
  const config = readJson(tree, file);
  writeJson(tree, file, { ...config, expo: native.withDesktop(config.expo ?? {}) });
}

function addDependency(tree) {
  const manifest = readJson(tree, 'package.json');
  const existing = { ...manifest.dependencies, ...manifest.devDependencies };
  const added = Object.entries(native.desktopDependencies).filter(([name]) => !(name in existing));
  if (!added.length) return;
  manifest.dependencies = Object.fromEntries(
    [...Object.entries(manifest.dependencies ?? {}), ...added].sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeJson(tree, 'package.json', manifest);
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
  return (tree, context) => {
    if (!tree.exists('angular.json')) {
      throw new SchematicsException('No angular.json here. Run this in an Angular CLI workspace.');
    }
    const workspace = readJson(tree, 'angular.json');
    const project = workspace.projects?.[options.project];
    if (!project) {
      throw new SchematicsException(`angular.json has no project called "${options.project}".`);
    }
    const root = project.root ?? '';
    addToAppJson(tree, root, context);
    addDependency(tree);
    ignorePackages(tree, root);
    const targets = desktopTargets();
    const architect = { ...project.architect };
    for (const [name, target] of Object.entries(targets)) architect[name] ??= target;
    workspace.projects[options.project] = { ...project, architect };
    writeJson(tree, 'angular.json', workspace);

    if (!options.skipInstall) context.addTask(new NodePackageInstallTask());
    context.logger.info(
      `${options.project} runs on macOS: ng serve ${options.project}, then ` +
        `ng run ${options.project}:macos. ng run ${options.project}:package makes the app.`,
    );
  };
}

module.exports = { desktop, desktopTargets };
