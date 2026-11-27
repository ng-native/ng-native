/**
 * What an Angular Native app is made of, in a Turborepo workspace.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release. `files/` holds verbatim copies of the template's files, the
 * versions are the template's own, and `native-app.test.ts` fails the moment either drifts from
 * it. Unlike in an Nx workspace, no file differs: Expo's Metro config finds a pnpm, npm, Yarn or
 * Bun workspace's packages itself, and the app's libraries are packages the package manager links,
 * so neither Metro nor TypeScript needs a path alias.
 *
 * What does not depend on Turborepo, the dependencies, `app.json` and bundle identifier among them,
 * is `@ng-native/migrate/native-app.cjs`, which `@ng-native/nx` and `@ng-native/schematics` build
 * their apps from too.
 */
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const shared = require('@ng-native/migrate/native-app.cjs');

/**
 * This package's directory. `turbo gen` bundles the workspace's generator config, this package
 * included, into one file beside the config, so `__dirname` is there rather than here and the
 * package is found through Node's resolution instead.
 */
function packageDir() {
  const manifest = path.join(__dirname, 'package.json');
  if (
    existsSync(manifest) &&
    JSON.parse(readFileSync(manifest, 'utf8')).name === '@ng-native/turbo'
  )
    return __dirname;
  return path.dirname(require.resolve('@ng-native/turbo/package.json'));
}

/** The template's files, copied verbatim into the new app. */
const SOURCE_FILES = [
  'src/app/app.ts',
  'src/main.ts',
  'src/app/app.test.ts',
  'src/app/app.device.ts',
  'vitest.config.mts',
  'metro.config.js',
  'tsconfig.json',
];

/** @param {string} name */
function sourceFile(name) {
  return readFileSync(path.join(packageDir(), 'files', ...name.split('/')), 'utf8');
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

/** Expo's own, which `expo start` listens on unless given `--port`. */
const DEFAULT_PORT = 8081;

/**
 * The app's scripts: the template's, `dev` and `build` for `turbo run`, and the typecheck that
 * reads `tsconfig.typecheck.json`, since the app's libraries are the package manager's links.
 *
 * @param {number} port the Metro port, Expo's default for the workspace's first app
 * @param {boolean} lint
 */
function scripts(port, lint) {
  const own = port === DEFAULT_PORT ? '' : ` --port ${port}`;
  return {
    dev: `expo start${own}`,
    start: `expo start${own}`,
    ios: `expo start --ios${own}`,
    android: `expo start --android${own}`,
    build: 'expo export --output-dir dist',
    typecheck: shared.TYPECHECK_ONE_COPY,
    test: shared.TEST,
    ...(lint && { lint: 'eslint .' }),
  };
}

/**
 * The app's own `turbo.json`: what `turbo run` caches of its tasks, and what invalidates it.
 *
 * `build` writes the iOS and Android bundles to `dist`, and Expo inlines each `EXPO_PUBLIC_`
 * variable into them, from the shell or from a `.env` file. Turborepo hashes no file git ignores,
 * and the template ignores `.env*.local`, so `.env*` is named as an input: without it a changed
 * `.env.local` replays the bundle built with the old value. `typecheck` caches no files: the
 * Tailwind sheet it builds into `.angular-native/` before `ngc` is there only once Tailwind is added,
 * and Turborepo warns on each run of a task whose outputs match nothing. A cache hit skips `ngc`,
 * which is all that reads the sheet, and Metro builds it again for `build` and `dev`.
 *
 * Metro, `ngc` and Vitest all compile the libraries' source with the app's, and Turborepo hashes a
 * workspace dependency into a task only through a `^` dependency. So each of the three depends on
 * its own task in the libraries, here rather than only in the root's `turbo.json`, which a
 * workspace may already define without it: a library edit otherwise replays the app's old bundle
 * or test run.
 */
const TURBO_JSON = {
  $schema: 'https://turborepo.com/schema.json',
  extends: ['//'],
  tasks: {
    build: {
      dependsOn: ['^build'],
      inputs: ['$TURBO_DEFAULT$', '.env*'],
      outputs: ['dist/**'],
    },
    typecheck: { dependsOn: ['^typecheck'] },
    test: { dependsOn: ['^test'] },
  },
};

module.exports = {
  ...shared,
  SOURCE_FILES,
  DEFAULT_PORT,
  TURBO_JSON,
  packageDir,
  sourceFile,
  agentsFile,
  scripts,
};
