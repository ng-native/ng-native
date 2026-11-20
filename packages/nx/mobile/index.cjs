/**
 * `nx g @ng-native/nx:mobile desktop`: a desktop-only Angular Native app that runs on iOS and
 * Android too, undoing what `--desktopOnly` left out.
 *
 * The app's `app.json` lists `ios` and `android` beside `macos` and `linux`, with the phone settings a mobile
 * app's has, and the app depends on the phone's status bar and system UI packages again. `nx.json`
 * stops keeping `@nx/expo`'s plugin off the app, so the plugin infers `run-ios`, `run-android` and
 * `prebuild` for it as for a mobile app. An app whose Metro is not on Expo's default port gets its
 * own `run-ios` and `run-android` with that port, as the application generator writes them, since
 * `expo run:ios` builds the port into the app.
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
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');
const {
  metroPort,
  updateAppJson,
  addMissingTargets,
  DEFAULT_PORT,
} = require('../desktop/index.cjs');
const { expoPluginInfers, includeInExpoPlugin } = require('../init/index.cjs');
const { registerSyncGenerator } = require('../sync/index.cjs');

/**
 * `run-ios` and `run-android` on the app's own port, or none on Expo's default where `@nx/expo`'s
 * plugin infers them. A registration that still keeps the plugin off the app (a broader `exclude`,
 * an `include` that leaves it out) gets them written in its place.
 */
function mobileTargets(project, inferred) {
  const port = metroPort(project);
  if (port === DEFAULT_PORT && inferred) return {};
  const flag = port === DEFAULT_PORT ? '' : ` --port ${port}`;
  const run = (os) => ({
    executor: 'nx:run-commands',
    options: { cwd: project.root, command: `expo run:${os}${flag}` },
    continuous: true,
  });
  return { 'run-ios': run('ios'), 'run-android': run('android') };
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ project: string, skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function mobile(tree, options) {
  const app = getProjects(tree).get(options.project);
  if (!app) throw new Error(`The workspace has no project called "${options.project}".`);
  const appJson = joinPathFragments(app.root, 'app.json');
  if (!tree.exists(appJson)) {
    throw new Error(
      `${options.project} is not an Angular Native app: it has no ${appJson}. ` +
        'Generate one with nx g @ng-native/nx:app.',
    );
  }
  updateAppJson(tree, appJson, native.withMobile);
  includeInExpoPlugin(tree, app.root);
  addMissingTargets(tree, options.project, mobileTargets(app, expoPluginInfers(tree, app.root)));
  registerSyncGenerator(tree, options.project);

  // With package-manager workspaces the app lists its own dependencies. Otherwise the root does,
  // and the app's package.json names them too, since Expo autolinks only the native modules there.
  const own = joinPathFragments(app.root, 'package.json');
  const manifests = usesWorkspaces(tree)
    ? [tree.exists(own) ? own : 'package.json']
    : ['package.json', ...(tree.exists(own) ? [own] : [])];
  const installs = manifests.map((manifest) =>
    addDependenciesToPackageJson(tree, native.mobileDependencies, {}, manifest, true),
  );
  if (!options.skipFormat) await formatFiles(tree);
  logger.info(
    `${options.project} runs on iOS and Android: nx run ${options.project}:run-ios, or ` +
      `nx run ${options.project}:run-android.`,
  );
  return options.skipInstall
    ? () => {}
    : () => (installs.forEach((install) => install()), installPackagesTask(tree));
}

module.exports = { mobile, default: mobile };
