/**
 * `ng generate @ng-native/schematics:mobile native`: a desktop-only Angular Native app that runs on
 * iOS and Android too, undoing what `--desktop-only` left out.
 *
 * The project's `app.json` lists `ios` and `android` beside `macos` and `linux`, with the phone settings a
 * mobile app's has. The workspace and the project's own `package.json`, whose native modules Expo
 * autolinks, depend on the phone's status bar and system UI packages again. And the project gains
 * `run-ios` and `run-android` on the `expo` builder, on the `serve` target's port.
 *
 * It only adds, so running it again changes nothing.
 */
const path = require('node:path').posix;
const { workspaces } = require('@angular-devkit/core');
const { SchematicsException } = require('@angular-devkit/schematics');
const { NodePackageInstallTask } = require('@angular-devkit/schematics/tasks');
const native = require('../native-app.cjs');
const {
  servePort,
  workspaceHost,
  updateAppJson,
  addDependencies,
} = require('../desktop/index.cjs');

/** The two targets, each on the `expo` builder, on the port `ng serve` runs Metro on. */
function mobileTargets(port) {
  const expo = (command) => ({
    builder: '@ng-native/schematics:expo',
    options: { command, ...(port ? { port } : {}) },
  });
  return { 'run-ios': expo('run:ios'), 'run-android': expo('run:android') };
}

/**
 * @param {{ project: string, skipInstall?: boolean }} options
 */
function mobile(options) {
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
    updateAppJson(tree, appJson, native.withMobile);
    for (const manifest of ['package.json', path.join(root, 'package.json')]) {
      addDependencies(tree, manifest, native.mobileDependencies);
    }
    const missing = Object.entries(mobileTargets(servePort(project))).filter(
      ([name]) => !project.targets.has(name),
    );
    for (const [name, target] of missing) project.targets.add({ name, ...target });
    if (missing.length) await workspaces.writeWorkspace(workspace, host);

    if (!options.skipInstall) context.addTask(new NodePackageInstallTask());
    context.logger.info(
      `${options.project} runs on iOS and Android: ng run ${options.project}:run-ios, or ` +
        `ng run ${options.project}:run-android.`,
    );
  };
}

module.exports = { mobile, mobileTargets };
