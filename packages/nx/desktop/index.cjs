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

/**
 * The port the app's `start` target runs Metro on, which the host loads the app from: its `expo
 * start` as `command` or in `commands`, each a string or an object with a `command`, as the
 * application generator writes and scans them.
 */
function metroPort(project) {
  const options = project.targets?.start?.options;
  const port = [options?.command, ...(options?.commands ?? [])]
    .map((entry) => (typeof entry === 'string' ? entry : entry?.command))
    .filter((command) => typeof command === 'string' && /\bexpo start\b/.test(command))
    .map((command) => /--port[= ](\d+)/.exec(command)?.[1])
    .find(Boolean);
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

/** The app's `app.json` with `withOs` applied to its Expo config, written only where it changed. */
function updateAppJson(tree, file, withOs) {
  const text = tree.read(file, 'utf-8') ?? '';
  const config = JSON.parse(text);
  const updated = { ...config, expo: withOs(config.expo ?? {}) };
  const json = `${JSON.stringify(updated, null, 2)}\n`;
  if (json !== text) tree.write(file, json);
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

/** The app's targets with each of `wanted` added that it does not have already. */
function addMissingTargets(tree, name, wanted) {
  const project = readProjectConfiguration(tree, name);
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
  const appJson = joinPathFragments(app.root, 'app.json');
  if (!tree.exists(appJson)) {
    throw new Error(
      `${options.project} is not an Angular Native app: it has no ${appJson}. ` +
        'Generate one with nx g @ng-native/nx:app.',
    );
  }
  updateAppJson(tree, appJson, native.withDesktop);
  addMissingTargets(tree, options.project, desktopTargets(app.root, metroPort(app)));
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

module.exports = {
  desktop,
  desktopTargets,
  metroPort,
  updateAppJson,
  addMissingTargets,
  DEFAULT_PORT,
  default: desktop,
};
