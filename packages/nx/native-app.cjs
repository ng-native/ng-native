/**
 * What an Angular Native app is made of, in an Nx workspace.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release. `files/` holds verbatim copies of the template's source files,
 * the versions are the template's own, and `native-app.test.ts` fails the moment either drifts
 * from it.
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
 * What does not depend on Nx, the dependencies, `app.json` and bundle identifier among them, is
 * `@ng-native/migrate/native-app.cjs`, which `@ng-native/schematics` builds its apps from too.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const shared = require('@ng-native/migrate/native-app.cjs');

const { dependencies, devDependencies, accepted } = shared;

/**
 * What `nx add` puts beside `@nx/expo`, in place of the `@nx/expo:init` it does not run: see
 * `init/index.cjs`. `@expo/cli`, `@babel/runtime` and `@expo/metro` are the ranges the template's
 * `expo` depends on, and `@babel/core` is the app's own, which every plugin in Expo's Babel preset peers on.
 */
const expoCompanions = {
  'react-dom': dependencies.react,
  '@expo/cli': '^57.0.27',
  '@babel/runtime': '^7.20.0',
  '@babel/core': devDependencies['@babel/core'],
  '@expo/metro': '~56.0.2',
};

/**
 * The template's `typecheck` script. It loads the Metro config first, which builds the sheet
 * `@ng-native/tailwind` generates into `.angular-native/` once and exits: `src/main.ts` imports it
 * once Tailwind is added, and a fresh checkout has none until Metro has run.
 */
const TYPECHECK = 'node metro.config.js && ngc -p tsconfig.json --noEmit';

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
  // The workspace's custom conditions, which a library in Nx's TypeScript preset exports its
  // source under; the Metro preset and the Vitest plugin read them from here too. Beside
  // Expo's own `react-native`, which setting the option would otherwise replace.
  const customConditions = ['react-native', ...conditions.filter((c) => c !== 'react-native')];
  if (!workspaceBase) {
    if (customConditions.length > 1) compilerOptions.customConditions = customConditions;
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
      customConditions,
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

module.exports = {
  ...shared,
  SOURCE_FILES,
  sourceFile,
  agentsFile,
  METRO_CONFIG,
  TYPECHECK,
  tsconfig,
  vitestConfig,
  reuseRootRanges,
  expoCompanions,
};
