/**
 * What an Angular Native app is made of, in an Nx workspace.
 *
 * The source of truth is `template/`, the starter `create-expo-app` uses and the setup this project
 * verifies before every release, and `template-desktop/` for a desktop-only app. `files/` holds
 * verbatim copies of the template's source files and `files/desktop/` of the desktop template's,
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
 * - `vitest.config.mts` resolves the workspace's path aliases when it has them, which Vitest does
 *   not read from tsconfig either: with Vite's own `resolve.tsconfigPaths` from Vite 8, and with
 *   `vite-tsconfig-paths` before it, as Nx 24 writes its own Vite configs for older Vite:
 *   `nxViteTsPaths` from `@nx/vite` is an inert stub there.
 *
 * What does not depend on Nx, the dependencies, `app.json` and bundle identifier among them, is
 * `@ng-native/migrate/native-app.cjs`, which `@ng-native/schematics` builds its apps from too.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { addDependenciesToPackageJson, readJson } = require('@nx/devkit');
const shared = require('@ng-native/migrate/native-app.cjs');

const { dependencies, devDependencies } = shared;

/**
 * What `nx add` puts beside `@nx/expo`, in place of the `@nx/expo:init` it does not run: see
 * `init/index.cjs`. `@expo/cli`, `@babel/runtime` and `@expo/metro` are the ranges the template's
 * `expo` depends on, and `@babel/core` is the app's own, which every plugin in Expo's Babel preset peers on.
 */
const expoCompanions = {
  'react-dom': dependencies.react,
  '@expo/cli': '^58.1.14',
  '@babel/runtime': '^7.20.0',
  '@babel/core': devDependencies['@babel/core'],
  '@expo/metro': '~58.0.0',
};

/** The template's files, copied verbatim into the new app. */
const SOURCE_FILES = [
  'src/app/app.ts',
  'src/main.ts',
  'src/app/app.test.ts',
  'src/app/app.device.ts',
];

/**
 * The desktop template's files that differ from the template's, which a desktop-only app takes
 * from `files/desktop/`: its starter screen, the screen's Node test and in-app test, the entry file
 * that starts the in-app tests, and the Vitest config with its macOS projects. Its `AGENTS.md`
 * comes from there too, through `agentsFile`. Its Metro config is the template's, `METRO_CONFIG`.
 */
const DESKTOP_SOURCE_FILES = [
  'src/app/app.ts',
  'src/app/app.test.ts',
  'src/app/app.device.ts',
  'src/main.ts',
  'vitest.config.mts',
];

/**
 * The desktop template's Vitest projects that run in Node, one for each OS, which `test` runs
 * alone: its others open the app.
 */
const DESKTOP_TEST = shared.DESKTOP_OSES.reduce(
  (command, os) => `${command} --project node-${os}`,
  'vitest run',
);

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
 * The template's Metro config, around `withNxMetro`, for a mobile app and a desktop-only one alike.
 * `withDeviceTests` resolves the in-app tests' host to nothing unless Metro starts with
 * `EXPO_PUBLIC_DEVICE_TESTS` set: a development bundle still bundles what a dead branch of
 * `main.ts` requires, and Vitest with it.
 */
const METRO_CONFIG = `const { withNxMetro } = require('@nx/expo');
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withDeviceTests } = require('@ng-native/testing/device/metro');

// withNxMetro resolves the workspace's libraries, through its tsconfig path aliases or its package
// manager's links, and watches them. withAngularNative registers the transformer that compiles
// Angular ahead of time, compiles each component's CSS into the sheet the engine reads, and adds
// the polyfills Angular needs before \`@angular/core\` is first evaluated. It goes on the outside,
// so its resolver can wrap Nx's: a library's \`./lib/ui.js\` import has to find \`ui.ts\`.
// withDeviceTests does nothing until Metro starts with EXPO_PUBLIC_DEVICE_TESTS set, for the tests
// that run inside the app.
module.exports = withDeviceTests(withAngularNative(withNxMetro(getDefaultConfig(__dirname))));
`;

/**
 * Where the options `mount` is given open in an app's `src/main.ts`, and the indent of their first
 * line: an object literal in the `mount(...)` call, as an older app writes them, or the object
 * `mountOptions()` returns, which the template's app and its in-app tests both mount with. A
 * generator adds a provider or the Tailwind sheet there.
 */
const MOUNT_OPTIONS = /(\bmount\([^\n]*\{\n|\bmountOptions = \(\) => \(\{\n)([ \t]*)/;

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
    return { extends: 'expo/tsconfig.base.json', compilerOptions, angularCompilerOptions };
  }
  // The workspace's base is written for a web build or for emitting declarations, and wins over
  // Expo's where they overlap. These are Expo's, restored: without `DOM` and `ESNext` the framework
  // packages' own source, which the app compiles, fails to typecheck. The workspace's stricter
  // `noPropertyAccessFromIndexSignature`, which Nx's Angular presets set, is put back too:
  // `src/main.ts` reads `process.env.EXPO_PUBLIC_DEVICE_TESTS` with a dot, the only form Expo's
  // Babel preset inlines, and the flag rejects that.
  return {
    extends: ['expo/tsconfig.base.json', workspaceBase],
    compilerOptions: {
      ...compilerOptions,
      noEmit: true,
      lib: ['DOM', 'ESNext'],
      target: 'ESNext',
      module: 'preserve',
      moduleResolution: 'bundler',
      customConditions,
      noPropertyAccessFromIndexSignature: false,
      composite: false,
      declaration: false,
      emitDeclarationOnly: false,
    },
    angularCompilerOptions,
  };
}

/**
 * @param {boolean} withPaths whether to resolve the workspace's tsconfig path aliases
 * @param {boolean} [viaVite] whether Vite does that itself, as from Vite 8, rather than the
 *   `vite-tsconfig-paths` plugin, which Vite 8 warns is no longer needed
 * @param {'app' | 'desktop' | 'library'} [variant] the template's config, with its Node, iOS and
 *   Android projects; the desktop template's, with a project for each desktop OS; or a library's, Node alone
 */
function vitestConfig(withPaths, variant = 'app', viaVite = false) {
  const config =
    variant === 'library'
      ? shared.LIBRARY_VITEST_CONFIG
      : readFileSync(
          path.join(
            __dirname,
            'files',
            ...(variant === 'desktop' ? ['desktop'] : []),
            'vitest.config.mts',
          ),
          'utf8',
        );
  if (!withPaths) return config;
  // Each project's: the phone template's one in Node, the desktop template's one for each OS.
  if (viaVite) {
    return config.replaceAll(
      'plugins: [ngNative(',
      'resolve: { tsconfigPaths: true }, plugins: [ngNative(',
    );
  }
  return config
    .replace(
      "import { defineConfig } from 'vitest/config';",
      "import tsconfigPaths from 'vite-tsconfig-paths';\n" +
        "import { defineConfig } from 'vitest/config';",
    )
    .replaceAll('plugins: [ngNative(', 'plugins: [tsconfigPaths(), ngNative(');
}

/**
 * What `vitestConfig(true)` imports, at the range Nx 24 adds for its own Vite configs, and Vite at
 * the range `@ng-native/testing` peers on. Both peer on Vite optionally, so npm installs it for
 * neither, and an integrated workspace from the `angular-monorepo` preset may have none at its root.
 */
const vitestPathsDependencies = {
  'vite-tsconfig-paths': '^5.1.4',
  vite: '^6.0.0 || ^7.0.0 || ^8.0.0',
};

/**
 * What `vitestConfig(true, variant, true)` needs: Vite at the first range that resolves tsconfig
 * paths itself, where the workspace has none.
 */
const vitestViaViteDependencies = { vite: '^8.0.0' };

/**
 * Adds what the tests' path aliases need to the root `package.json`, keeping a version it has:
 * Vite alone where Vite resolves them, and `vite-tsconfig-paths` with Vite otherwise.
 */
function addVitestPathsDependencies(tree) {
  const viaVite = shared.viteResolvesPaths(readJson(tree, 'package.json'));
  const wanted = viaVite ? vitestViaViteDependencies : vitestPathsDependencies;
  addDependenciesToPackageJson(tree, {}, wanted, 'package.json', true);
}

/** The names a flat ESLint config at a workspace's root can have, and one an ES module can import. */
const ROOT_ESLINT_CONFIGS = ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs'];

/**
 * The app's `eslint.config.mjs`. In a workspace with a flat config at its root, as Nx's presets
 * write, it spreads that first, as the configs `@nx/angular` generates do: the root's
 * `@nx/enforce-module-boundaries` and its other rules would otherwise not apply to the app, and
 * `nx lint` would pass what the workspace's own ESLint run fails.
 *
 * @param {string | undefined} rootConfig the root config's path from the app's directory
 */
function eslintConfig(rootConfig) {
  if (!rootConfig) return shared.ESLINT_CONFIG;
  return shared.ESLINT_CONFIG.replace(
    "import ngNative from '@ng-native/eslint-plugin';\n",
    `import baseConfig from '${rootConfig}';\nimport ngNative from '@ng-native/eslint-plugin';\n`,
  ).replace('export default [\n', 'export default [\n  ...baseConfig,\n');
}

module.exports = {
  ...shared,
  SOURCE_FILES,
  DESKTOP_SOURCE_FILES,
  DESKTOP_TEST,
  sourceFile,
  agentsFile,
  METRO_CONFIG,
  MOUNT_OPTIONS,
  tsconfig,
  vitestConfig,
  vitestPathsDependencies,
  vitestViaViteDependencies,
  viteResolvesPaths: shared.viteResolvesPaths,
  ROOT_ESLINT_CONFIGS,
  eslintConfig,
  addVitestPathsDependencies,
  expoCompanions,
};
