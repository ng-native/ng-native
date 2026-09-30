/**
 * What an Angular Native app is made of, in an Nx workspace.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release. `files/` holds verbatim copies of the template's source files and
 * the versions below are the template's own, and `native-app.test.ts` fails the moment either
 * drifts from it.
 *
 * Three files differ from the template's, each because of something Nx does:
 *
 * - `metro.config.js` wraps the preset in `withNxMetro`, which resolves the workspace's tsconfig
 *   path aliases and watches its libraries. Without it an app in an integrated workspace cannot
 *   import a library at all: Metro reports `Cannot resolve @org/ui`.
 * - `tsconfig.json` also extends the workspace's `tsconfig.base.json` when there is one, which is
 *   where those aliases live, and puts back the Expo settings the workspace's base overrides.
 * - `vitest.config.mts` adds `nxViteTsPaths` when the workspace has `@nx/vite`, for the same
 *   aliases, which Vitest does not read from tsconfig either.
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
  expo: '~57.0.26',
  'expo-status-bar': '~57.0.1',
  'expo-system-ui': '~57.0.4',
  react: '19.2.3',
  'react-native': '0.86.3',
  'react-native-safe-area-context': '~5.7.0',
};

/**
 * What `nx add` puts beside `@nx/expo`, in place of the `@nx/expo:init` it does not run: see
 * `init/index.cjs`. `@expo/cli` and `@babel/runtime` are the ranges the template's `expo` depends
 * on.
 */
const expoCompanions = {
  'react-dom': dependencies.react,
  '@expo/cli': '^57.0.27',
  '@babel/runtime': '^7.20.0',
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

/** The template's files, copied verbatim into the new app. */
const SOURCE_FILES = ['src/app/app.ts', 'src/main.ts', 'src/app/app.test.ts'];

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

/** Java's reserved words, which Android refuses as a segment of a package name. */
const JAVA_KEYWORDS = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double ' +
    'else enum extends false final finally float for goto if implements import instanceof int ' +
    'interface long native new null package private protected public return short static ' +
    'strictfp super switch synchronized this throw throws transient true try void volatile while'
  ).split(' '),
);

/**
 * Whether iOS takes `id` as a bundle identifier and Android as a package name: two or more
 * segments, each a letter and then letters or digits (iOS refuses `_`, Android `-`), none of them
 * a Java keyword.
 *
 * @param {string} id
 */
function isBundleIdentifier(id) {
  const segments = id.split('.');
  return (
    segments.length > 1 &&
    segments.every((s) => /^[a-z][a-z0-9]*$/i.test(s) && !JAVA_KEYWORDS.has(s))
  );
}

/**
 * `com.<scope>.<name>`, for an app given no `--bundleIdentifier`, where prebuild would otherwise
 * make it `com.anonymous.<name>`. The scope is left out when it cannot be made a segment.
 *
 * @param {string} name the app's name, without a scope
 * @param {string | undefined} scope the workspace's npm scope, `@acme`
 */
function bundleIdentifier(name, scope) {
  const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const valid = (segment) => /^[a-z]/.test(segment) && !JAVA_KEYWORDS.has(segment);
  const org = clean(scope ?? '');
  const app = clean(name);
  return ['com', ...(valid(org) ? [org] : []), valid(app) ? app : `app${app}`].join('.');
}

/**
 * The template's `app.json`, named for this app, without the template's icons: they are the
 * template's branding, and Expo draws its own default until `icon` is set.
 *
 * @param {string} name the project name, which is also the Expo slug
 * @param {string} [id] the iOS bundle identifier and Android package, by default one from `name`
 */
function appJson(name, id) {
  const slug = name.replace(/^@[^/]+\//, '');
  const bundle = id ?? bundleIdentifier(slug, name.match(/^@[^/]+/)?.[0]);
  const expo = {
    name: slug,
    slug,
    version: '1.0.0',
    // Not left to Expo, which adds `web` whenever `react-dom` resolves, and @nx/react puts one there.
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    ios: { supportsTablet: true, bundleIdentifier: bundle },
    android: { package: bundle, predictiveBackGestureEnabled: false },
    scheme: slug.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    // The template's: Expo otherwise guesses a router root from src/app and says so on every start.
    extra: { router: { root: 'src/app' } },
    plugins: ['@ng-native/metro'],
  };
  return JSON.stringify({ expo }, null, 2) + '\n';
}

const METRO_CONFIG = `const { withNxMetro } = require('@nx/expo');
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');

// withNxMetro resolves the workspace's libraries, through its tsconfig path aliases or its package
// manager's links, and watches them. withAngularNative registers the transformer that compiles
// Angular ahead of time, compiles each component's CSS into the sheet the engine reads, and adds
// the polyfills Angular needs before \`@angular/core\` is first evaluated. It goes on the outside,
// so its resolver can wrap Nx's: a library's \`./lib/ui.js\` import has to find \`ui.ts\`.
module.exports = withAngularNative(withNxMetro(getDefaultConfig(__dirname)));
`;

/**
 * @param {string | undefined} workspaceBase the workspace's `tsconfig.base.json`, relative to the
 *   app, when there is one to take path aliases from
 */
function tsconfig(workspaceBase, conditions = []) {
  const compilerOptions = { strict: true, allowImportingTsExtensions: true };
  // The template's own: templates checked strictly, less the two checks that read a native host
  // element's props and events as a DOM element's.
  const angularCompilerOptions = {
    strictTemplates: true,
    typeCheckHostBindings: false,
    strictDomEventTypes: false,
  };
  if (!workspaceBase) {
    // The workspace's custom conditions, which a library in Nx's TypeScript preset exports its
    // source under; the Metro preset and the Vitest plugin read them from here too. Beside
    // Expo's own `react-native`, which setting the option would otherwise replace.
    const extra = conditions.filter((c) => c !== 'react-native');
    if (extra.length) compilerOptions.customConditions = ['react-native', ...extra];
    return { extends: 'expo/tsconfig.base', compilerOptions, angularCompilerOptions };
  }
  // The workspace's base is written for a web build or for emitting declarations, and wins over
  // Expo's where they overlap. These are Expo's, restored: without `DOM` and `ESNext` the framework
  // packages' own source, which the app compiles, fails to typecheck.
  return {
    extends: ['expo/tsconfig.base', workspaceBase],
    compilerOptions: {
      ...compilerOptions,
      noEmit: true,
      lib: ['DOM', 'ESNext'],
      target: 'ESNext',
      module: 'preserve',
      moduleResolution: 'bundler',
      customConditions: ['react-native'],
      composite: false,
      declaration: false,
      emitDeclarationOnly: false,
    },
    angularCompilerOptions,
  };
}

/** @param {boolean} withPaths whether to resolve the workspace's tsconfig path aliases */
function vitestConfig(withPaths) {
  const template = readFileSync(path.join(__dirname, 'files', 'vitest.config.mts'), 'utf8');
  if (!withPaths) return template;
  return template
    .replace(
      "import { defineConfig } from 'vitest/config';",
      "import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';\n" +
        "import { defineConfig } from 'vitest/config';",
    )
    .replace('plugins: [ngNative()],', 'plugins: [nxViteTsPaths(), ngNative()],');
}

/**
 * The dependencies an integrated workspace's app lists in its own `package.json`, at the ranges
 * the root installs, though nothing installs from it.
 *
 * All of them, because Expo's autolinking links the native modules the app's `package.json` names
 * and no others: without `react-native-safe-area-context` here, Android crashed on RNCSafeAreaView.
 * And `expo prebuild`, which `expo run:ios` starts with, adds `expo`, `react` or `react-native` if
 * it does not find them and then offers to install them into the app's directory, which would put a
 * second copy of React Native beside the root's.
 *
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} root
 */
function prebuildPins(root) {
  const installed = { ...root.devDependencies, ...root.dependencies };
  return Object.fromEntries(
    Object.keys(dependencies).map((pkg) => [pkg, installed[pkg] ?? dependencies[pkg]]),
  );
}

/**
 * Where what a workspace already has can be older than what a new app is given: `@ng-native/testing`
 * installs Vitest 5 but its plugin runs on 4, which `ng new` 22.1 and the Nx preset still start on.
 * The range here is that package's `vitest` peer, and a test holds the two together.
 */
const accepted = { vitest: '^4.0.8 || ^5.0.0' };

/**
 * The ranges a workspace package's `package.json` lists: the root's own where everything it can
 * resolve to is a version Angular Native accepts, so that pnpm does not install a second Vitest
 * beside the root's. A wider root range is not reused: React Native needs its exact React, not
 * whatever `^19.0.0` resolves to.
 *
 * @param {Record<string, string>} wanted
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} root
 */
function reuseRootRanges(wanted, root) {
  const installed = { ...root.devDependencies, ...root.dependencies };
  return Object.fromEntries(
    Object.entries(wanted).map(([name, range]) => {
      const existing = installed[name];
      const reuse =
        existing &&
        !name.startsWith('@ng-native/') &&
        semver.validRange(existing) &&
        semver.subset(existing, accepted[name] ?? range);
      return [name, reuse ? existing : range];
    }),
  );
}

/**
 * Why an existing dependency would stop this app installing or running, as a sentence each.
 *
 * Only ranges already in the manifest are judged, and only a range that cannot overlap the one
 * wanted is a conflict: `~6.0.2` and `~6.0.3` resolve to the same TypeScript. A missing package is
 * added at the version above. Nothing is rewritten, because moving a workspace's Angular or Vitest
 * is an upgrade of every project in it, and that belongs to `nx migrate`, not to a generator.
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
  bundleIdentifier,
  isBundleIdentifier,
  METRO_CONFIG,
  tsconfig,
  vitestConfig,
  prebuildPins,
  reuseRootRanges,
  expoCompanions,
  conflicts,
  accepted,
};
