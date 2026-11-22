/**
 * What an Angular Native app is made of, whichever workspace it is generated into.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release. `files/` holds verbatim copies of the template's source files,
 * the versions are the template's own, and `native-app.test.ts` fails the moment either drifts
 * from it. A generated app and a templated app are the same app.
 *
 * What does not depend on the Angular CLI, the dependencies, `app.json` and bundle identifier
 * among them, is `@ng-native/migrate/native-app.cjs`, which `@ng-native/nx` builds its apps from too.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const shared = require('@ng-native/migrate/native-app.cjs');

/**
 * The template's files, copied verbatim into the new app. Its `metro.config.js` and `tsconfig.json`
 * need nothing changed here: the dependencies are hoisted to the workspace root, where Node's and
 * Metro's resolution both find them by walking up.
 */
const SOURCE_FILES = [
  'src/app/app.ts',
  'src/main.ts',
  'src/app/app.test.ts',
  'src/app/app.device.ts',
  'vitest.config.mts',
  'metro.config.js',
  'tsconfig.json',
];

/**
 * The desktop template's files that differ from the template's, which a desktop-only app takes
 * from `files/desktop/`: its starter screen, the screen's Node test and in-app test, the entry file
 * that starts the in-app tests, and the Vitest config with its macOS projects. Its `AGENTS.md`
 * comes from there too, through `agentsFile`.
 */
const DESKTOP_SOURCE_FILES = [
  'src/app/app.ts',
  'src/app/app.test.ts',
  'src/app/app.device.ts',
  'src/main.ts',
  'vitest.config.mts',
];

/**
 * The template's Vitest project that runs in Node, which `ng test` runs alone: its `ios` and
 * `android` projects build and open the app.
 */
const TEST_PROJECT = 'node';

/**
 * The desktop template's Vitest projects that run in Node, one for each OS, which `ng test` runs
 * alone: its others open the app.
 */
const DESKTOP_TEST_PROJECTS = shared.DESKTOP_OSES.map((os) => `node-${os}`);

/**
 * @param {string} name
 * @param {boolean} [desktopOnly] the desktop template's copy, where it has one of its own
 */
function sourceFile(name, desktopOnly = false) {
  const own = desktopOnly && (DESKTOP_SOURCE_FILES.includes(name) || name === 'AGENTS.md');
  return readFileSync(path.join(__dirname, 'files', own ? 'desktop' : '', name), 'utf8');
}

/**
 * The template's `AGENTS.md`, with its Commands section replaced by this workspace's own. The rest
 * describes the framework, which is the same wherever the app lives.
 *
 * @param {string} commands the markdown that goes under the Commands heading
 * @param {boolean} [desktopOnly] the desktop template's, for a desktop-only app
 */
function agentsFile(commands, desktopOnly = false) {
  return sourceFile('AGENTS.md', desktopOnly).replace(
    /## Commands\n[\s\S]*?(?=\n## )/,
    `## Commands\n\n${commands}\n`,
  );
}

/**
 * The project's own `package.json`, which only Expo reads: `main` is how it finds the entry file,
 * and `prebuildPins` says why it lists every dependency the app has.
 *
 * @param {string} name
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} root
 *   the workspace's root `package.json`, once this app's dependencies are in it
 * @param {boolean} [desktopOnly] a desktop-only app, with the desktop template's dependencies
 */
function projectManifest(name, root, desktopOnly = false) {
  const wanted = desktopOnly ? shared.desktopOnlyDependencies : shared.dependencies;
  return {
    name,
    private: true,
    main: 'src/main.ts',
    dependencies: shared.prebuildPins(root, wanted),
  };
}

module.exports = {
  ...shared,
  SOURCE_FILES,
  DESKTOP_SOURCE_FILES,
  DESKTOP_TEST_PROJECTS,
  TEST_PROJECT,
  sourceFile,
  agentsFile,
  projectManifest,
};
