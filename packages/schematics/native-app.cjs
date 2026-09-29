/**
 * What an Angular Native app is made of, whichever workspace it is generated into.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release. `files/` holds verbatim copies of the template's source files and
 * the versions below are the template's own, and `native-app.test.ts` fails the moment either
 * drifts from it. A generated app and a templated app are the same app.
 *
 * The `@ng-native/*` packages are pinned to this package's own version, because every one of them
 * is released in lockstep with it.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const { version } = require('./package.json');

const FRAMEWORK = [
  '@ng-native/components',
  '@ng-native/device',
  '@ng-native/fabric',
  '@ng-native/metro',
  '@ng-native/platform',
];

/** @type {Record<string, string>} */
const dependencies = {
  ...Object.fromEntries(FRAMEWORK.map((name) => [name, version])),
  '@angular/common': '^22.0.0',
  '@angular/core': '^22.0.0',
  expo: '~57.0.20',
  'expo-status-bar': '~57.0.1',
  react: '19.2.3',
  'react-native': '0.86.3',
  'react-native-safe-area-context': '~5.7.0',
};

/** @type {Record<string, string>} */
const devDependencies = {
  // An Angular workspace already has Babel 8 through @angular/compiler-cli, and React Native's
  // Babel peer would otherwise take the newest copy there is.
  // The typecheck script compiles the templates too, which only the Angular compiler can.
  '@angular/compiler-cli': '^22.0.0',
  '@babel/core': '^7.29.7',
  '@ng-native/testing': version,
  '@types/react': '~19.2.2',
  typescript: '~6.0.3',
  vitest: '^5.0.0',
};

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
 * The template's `app.json`, named for this app.
 *
 * Without the template's icons: they are the template's branding, not this app's, and Expo draws
 * its own default until `icon` is set.
 *
 * @param {string} name the project name, which is also the Expo slug
 */
function appJson(name) {
  const expo = {
    name,
    slug: name,
    version: '1.0.0',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    ios: { supportsTablet: true },
    android: { predictiveBackGestureEnabled: false },
    scheme: name.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    // The template's: Expo otherwise guesses a router root from src/app and says so on every start.
    extra: { router: { root: 'src/app' } },
  };
  return JSON.stringify({ expo }, null, 2) + '\n';
}

/**
 * The project's own `package.json`, which only Expo reads: `main` is how it finds the entry file.
 *
 * It lists every dependency the app has too, at the ranges the workspace root installs, though
 * nothing installs from it. Expo's autolinking links the native modules named here and no others,
 * so one left out, such as `react-native-safe-area-context`, is missing from the native build. And
 * `expo prebuild`, which `expo run:ios` starts with, adds `expo`, `react` or `react-native` if it
 * does not find them and then offers to install them into the project's directory, which would put
 * a second copy of React Native beside the root's.
 *
 * @param {string} name
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} root
 *   the workspace's root `package.json`, once this app's dependencies are in it
 */
function projectManifest(name, root) {
  const installed = { ...root.devDependencies, ...root.dependencies };
  const pinned = Object.keys(dependencies).map((pkg) => [pkg, installed[pkg] ?? dependencies[pkg]]);
  return { name, private: true, main: 'src/main.ts', dependencies: Object.fromEntries(pinned) };
}

/**
 * Where what a workspace already has can be older than what a new app is given: `@ng-native/testing`
 * installs Vitest 5 but its plugin runs on 4, which `ng new` 22.1 and the Nx preset still start on.
 * The range here is that package's `vitest` peer, and a test holds the two together.
 */
const accepted = { vitest: '^4.0.8 || ^5.0.0' };

/**
 * Why an existing dependency would stop this app installing or running, as a sentence each.
 *
 * Only ranges already in the manifest are judged, and only a range that cannot overlap the one
 * wanted is a conflict: `~6.0.2` and `~6.0.3` resolve to the same TypeScript. A missing package is
 * added at the version above. Nothing is rewritten, because moving a workspace's Angular or Vitest is an upgrade of every
 * project in it, and that belongs to `ng update` or `nx migrate`, not to a generator.
 *
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} manifest
 * @returns {string[]}
 */
function conflicts(manifest) {
  const existing = { ...manifest.dependencies, ...manifest.devDependencies };
  const problems = [];
  for (const [name, installed] of Object.entries({ ...dependencies, ...devDependencies })) {
    const range = existing[name];
    const wanted = accepted[name] ?? installed;
    if (!range || name.startsWith('@ng-native/')) continue;
    if (semver.validRange(range) && !semver.intersects(range, wanted)) {
      problems.push(
        `${name} is ${range} here, and Angular Native needs ${wanted}. ` +
          `npm will refuse the install until it is moved.`,
      );
    }
  }
  return problems;
}

module.exports = {
  dependencies,
  devDependencies,
  SOURCE_FILES,
  sourceFile,
  agentsFile,
  appJson,
  projectManifest,
  conflicts,
  accepted,
};
