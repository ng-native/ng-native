/**
 * `turbo gen ng-native-library`: a library of Angular Native components, as a package of this
 * workspace, tested the way an app is.
 *
 * The library exports its TypeScript source, with no build of its own: an app's Metro compiles its
 * components ahead of time with the app's, and Vitest's `ngNative()` plugin does the same for its
 * tests. It lists Angular and `@ng-native/components` as peer dependencies, so that the app's copy
 * is the one in the bundle, and as dev dependencies at the app's versions, for its own tests and
 * typecheck. Its `typecheck` is `ngc`, which checks the templates too.
 */
const path = require('node:path').posix;
const native = require('../native-app.cjs');
const { asSaved } = require('@ng-native/migrate/save-exact.cjs');
const { includeInWorkspaces } = require('@ng-native/migrate/workspace-globs.cjs');
const { commandsFor, packageManager, packageName: packageNameOf } = require('../workspace.cjs');
const { writeComponent, selectorPrefix, names } = require('../component/index.cjs');

/** @typedef {ReturnType<typeof import('../files.cjs').workspaceFiles>} Files */

/**
 * What the library's components import, which the app provides: Angular at the app's range, and
 * the components at the app's version or later. `@ng-native/migrate` moves the version a manifest
 * installs and leaves a peer range alone, so an exact one would no longer match the app's after an
 * update.
 */
const peerDependencies = {
  '@angular/core': native.dependencies['@angular/core'],
  '@ng-native/components': `>=${native.dependencies['@ng-native/components']}`,
};

/**
 * What its tests and typecheck run on. `@babel/core` is the app's Babel 7: `@angular/compiler-cli`
 * depends on Babel 8, which would otherwise answer the `@babel/core` peer of React Native's
 * codegen, giving the library copies of its own of `react-native` and `expo`.
 */
const devDependencies = {
  '@angular/compiler-cli': native.devDependencies['@angular/compiler-cli'],
  '@angular/core': native.dependencies['@angular/core'],
  '@babel/core': native.devDependencies['@babel/core'],
  '@ng-native/components': native.dependencies['@ng-native/components'],
  '@ng-native/testing': native.devDependencies['@ng-native/testing'],
  typescript: native.devDependencies.typescript,
  vitest: native.devDependencies.vitest,
};

/**
 * The library's `tsconfig.json`, for `ngc` and the editor: Expo's settings an app has, without
 * extending Expo's base, which a library does not install, and the app's Angular options, since a
 * native view has no DOM to check a host binding or an event against.
 */
const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ESNext',
    module: 'preserve',
    moduleResolution: 'bundler',
    lib: ['DOM', 'ESNext'],
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
  },
  include: ['src', 'vitest.config.mts'],
  angularCompilerOptions: {
    strictTemplates: true,
    typeCheckHostBindings: false,
    strictDomEventTypes: false,
  },
};

/**
 * @param {Files} files
 * @param {{ directory: string }} options
 * @returns {Promise<string>}
 */
async function library(files, options) {
  const directory = path.normalize(options.directory.trim().replace(/\\/g, '/')).replace(/\/$/, '');
  if (!directory || directory === '.' || directory.startsWith('..') || path.isAbsolute(directory)) {
    throw new Error(
      `${options.directory} is not a directory inside the workspace: give one like packages/ui.`,
    );
  }
  if (files.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} already has a package.json. Choose another directory.`);
  }
  // Both names checked before anything is written.
  const { name, packageName } = packageNameOf(files, directory);
  const { fileName } = names(name);
  includeInWorkspaces(files, directory);

  const root = files.readJson('package.json') ?? {};
  const own = (wanted) => asSaved(files, native.reuseRootRanges(wanted, root));
  const manifest = {
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    scripts: { typecheck: 'ngc -p tsconfig.json', test: 'vitest run' },
    peerDependencies,
    devDependencies: await own(devDependencies),
  };
  files.write(`${directory}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
  files.write(`${directory}/tsconfig.json`, JSON.stringify(TSCONFIG, null, 2) + '\n');
  files.write(`${directory}/vitest.config.mts`, native.LIBRARY_VITEST_CONFIG);

  const className = writeComponent(
    files,
    `${directory}/src/lib`,
    fileName,
    selectorPrefix(packageName),
  );
  files.write(
    `${directory}/src/index.ts`,
    `export { ${className} } from './lib/${fileName}.ts';\n`,
  );

  const manager = packageManager(files);
  const run = commandsFor(manager);
  // npm links a workspace package for any range it satisfies, and has no `workspace:` protocol.
  const range = manager === 'npm' ? '*' : 'workspace:*';
  return (
    `Created ${packageName} in ${directory}. Add "${packageName}": "${range}" to an app's ` +
    `dependencies, run ${run.install}, and import ${className} from '${packageName}'. ` +
    `${run.turbo('test', packageName)} runs its tests.`
  );
}

module.exports = { library, TSCONFIG };
