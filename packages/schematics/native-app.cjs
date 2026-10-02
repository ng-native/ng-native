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
  'vitest.config.mts',
  'metro.config.js',
  'tsconfig.json',
];

/** @param {string} name */
function sourceFile(name) {
  return readFileSync(path.join(__dirname, 'files', name), 'utf8');
}

/**
 * The template's `AGENTS.md`, with its Commands section replaced by this workspace's own. The rest
 * describes the framework, which is the same wherever the app lives.
 *
 * @param {string} commands the markdown that goes under the Commands heading
 */
function agentsFile(commands) {
  return sourceFile('AGENTS.md').replace(
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
 */
function projectManifest(name, root) {
  return { name, private: true, main: 'src/main.ts', dependencies: shared.prebuildPins(root) };
}

module.exports = {
  ...shared,
  SOURCE_FILES,
  sourceFile,
  agentsFile,
  projectManifest,
};
