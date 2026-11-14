/**
 * `nx g @ng-native/nx:desktop mobile`: an Angular Native app that runs on macOS too.
 *
 * The app's `app.json` lists `macos` with Expo's `experiments.outOfTreePlatforms` (without it Expo
 * drops `macos` from every bundle and export, and says nothing) and the `@ng-native/desktop` config
 * plugin. The app depends on `@ng-native/desktop`, whose `ng-native-desktop` command the two new
 * targets run: `macos` builds the desktop host and opens the app from the dev server `nx start`
 * runs, and `package` makes the `.app`, `.dmg` or Mac App Store package. The Expo CLI has no
 * `run:macos` to infer one from.
 *
 * It only adds, so running it again changes nothing.
 */
const {
  addDependenciesToPackageJson,
  formatFiles,
  getProjects,
  installPackagesTask,
  joinPathFragments,
  logger,
  readProjectConfiguration,
  updateProjectConfiguration,
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');

/** Expo's own, which `expo start` listens on unless given `--port`. */
const DEFAULT_PORT = 8081;

/** The port the app's `start` target runs Metro on, which the host loads the app from. */
function metroPort(project) {
  const command = project.targets?.start?.options?.command;
  const port = typeof command === 'string' ? /--port[= ](\d+)/.exec(command)?.[1] : undefined;
  return port ? Number(port) : DEFAULT_PORT;
}

/**
 * The two targets. `macos` is continuous, as `start` is: the host stays open on the app until it
 * quits.
 */
function desktopTargets(root, port) {
  const run = (command) => ({ executor: 'nx:run-commands', options: { cwd: root, command } });
  const own = port === DEFAULT_PORT ? '' : ` --port ${port}`;
  return {
    macos: { ...run(`${native.DESKTOP_SCRIPTS.macos}${own}`), continuous: true },
    package: run(native.DESKTOP_SCRIPTS.package),
  };
}

/** @returns {boolean} whether `app.json` was there to change */
function addToAppJson(tree, root) {
  const file = joinPathFragments(root, 'app.json');
  const text = tree.read(file, 'utf-8');
  if (text === null) {
    logger.warn(
      `Could not update ${file}: it does not exist. Add "macos" to expo.platforms, set ` +
        'expo.experiments.outOfTreePlatforms to true and add "@ng-native/desktop" to expo.plugins.',
    );
    return false;
  }
  const config = JSON.parse(text);
  const updated = { ...config, expo: native.withDesktop(config.expo ?? {}) };
  const json = `${JSON.stringify(updated, null, 2)}\n`;
  if (json !== text) tree.write(file, json);
  return true;
}

/** The lines of `native.DESKTOP_GITIGNORE` the app's `.gitignore` lacks, appended. */
function ignorePackages(tree, root) {
  const file = joinPathFragments(root, '.gitignore');
  const ignore = tree.read(file, 'utf-8') ?? '';
  const rules = native.DESKTOP_GITIGNORE.split('\n').filter(
    (line) => line && !line.startsWith('#'),
  );
  if (rules.every((rule) => ignore.split('\n').includes(rule))) return;
  const separator = ignore === '' ? '' : ignore.endsWith('\n') ? '\n' : '\n\n';
  tree.write(file, `${ignore}${separator}${native.DESKTOP_GITIGNORE}`);
}

/**
 * The app's targets with `macos` and `package` added, where it has neither already.
 */
function addTargets(tree, name) {
  const project = readProjectConfiguration(tree, name);
  const wanted = desktopTargets(project.root, metroPort(project));
  const missing = Object.entries(wanted).filter(([target]) => !project.targets?.[target]);
  if (!missing.length) return;
  const targets = { ...project.targets, ...Object.fromEntries(missing) };
  updateProjectConfiguration(tree, name, { ...project, targets });
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ project: string, skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function desktop(tree, options) {
  const app = getProjects(tree).get(options.project);
  if (!app) throw new Error(`The workspace has no project called "${options.project}".`);
  addToAppJson(tree, app.root);
  addTargets(tree, options.project);
  ignorePackages(tree, app.root);

  const own = joinPathFragments(app.root, 'package.json');
  const manifest = usesWorkspaces(tree) && tree.exists(own) ? own : 'package.json';
  const install = addDependenciesToPackageJson(tree, native.desktopDependencies, {}, manifest);
  if (!options.skipFormat) await formatFiles(tree);
  logger.info(
    `${options.project} runs on macOS: nx start ${options.project}, then ` +
      `nx run ${options.project}:macos. nx run ${options.project}:package makes the app.`,
  );
  return options.skipInstall ? () => {} : () => (install(), installPackagesTask(tree));
}

module.exports = { desktop, desktopTargets, default: desktop };
