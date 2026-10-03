/**
 * `nx g @ng-native/nx:library packages/ui`: a library of native components, tested the way an
 * Angular Native app is.
 *
 * The library itself is the workspace's own kind: `@nx/angular:library` where the workspace has
 * `@nx/angular`, and `@nx/js:library` in the TypeScript preset, which cannot take `@nx/angular`
 * because Angular does not support TypeScript project references. Either is run without its
 * tests, which would be Analog on jsdom or a plain Vitest, neither of which can render a native
 * component. In their place this writes the app's `vitest.config.mts`, a `test` target that runs
 * it once, a `tsconfig.spec.json` for the tests, and a native component with a test for the fake
 * Fabric in place of the one the generator wrote.
 */
const { readFileSync } = require('node:fs');
const nodePath = require('node:path');
const path = nodePath.posix;
const {
  addDependenciesToPackageJson,
  ensurePackage,
  formatFiles,
  getProjects,
  installPackagesTask,
  joinPathFragments,
  names,
  readNxJson,
  readJson,
  updateJson,
  updateProjectConfiguration,
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { workspaceNxVersion } = require('../init/index.cjs');
const { hasPathAliases } = require('../application/index.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');
const { asSaved } = require('../save-exact.cjs');
const { writeComponent } = require('../component/index.cjs');

/**
 * The defaults a generator's schema gives its options, from the copy installed at `root`.
 *
 * @param {string} root
 * @param {string} pkg
 * @param {string} generator
 * @returns {Record<string, unknown>}
 */
function schemaDefaults(root, pkg, generator) {
  let manifest;
  try {
    manifest = require.resolve(`${pkg}/package.json`, { paths: [root] });
  } catch {
    return {};
  }
  const read = (file) =>
    JSON.parse(readFileSync(nodePath.join(nodePath.dirname(manifest), file), 'utf8'));
  const entry = read(read('package.json').generators).generators[generator];
  const { properties = {} } = read(entry.schema);
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, property]) => 'default' in property)
      .map(([name, property]) => [name, property.default]),
  );
}

/**
 * The options `nx g <pkg>:<generator>` starts from: its schema's defaults, then the workspace's
 * own in `nx.json`. A generator called from another gets neither, and `@nx/angular:library` called
 * bare writes a library with strict type checking off.
 *
 * @param {import('@nx/devkit').Tree} tree
 * @param {string} pkg
 * @param {string} generator
 */
function generatorDefaults(tree, pkg, generator, root = tree.root) {
  const workspace = readNxJson(tree)?.generators ?? {};
  return {
    ...schemaDefaults(root, pkg, generator),
    ...workspace[pkg]?.[generator],
    ...workspace[`${pkg}:${generator}`],
  };
}

/** The library generators this one builds on, at the workspace's Nx. Replaced in tests. */
const bases = {
  /** @param {import('@nx/devkit').Tree} tree @param {object} options */
  async angular(tree, options) {
    // Only run where the workspace lists `@nx/angular`, whose root export has no generators.
    const { libraryGenerator } = ensurePackage('@nx/angular/generators', workspaceNxVersion(tree));
    return libraryGenerator(tree, {
      ...generatorDefaults(tree, '@nx/angular', 'library'),
      ...options,
    });
  },
  /** @param {import('@nx/devkit').Tree} tree @param {object} options */
  async js(tree, options) {
    const { libraryGenerator } = ensurePackage('@nx/js', workspaceNxVersion(tree));
    return libraryGenerator(tree, { ...generatorDefaults(tree, '@nx/js', 'library'), ...options });
  },
};

/** What the component and its test import. */
const imports = {
  dependencies: {
    '@angular/core': native.dependencies['@angular/core'],
    '@ng-native/components': native.dependencies['@ng-native/components'],
  },
  devDependencies: {
    '@ng-native/testing': native.devDependencies['@ng-native/testing'],
    vitest: native.devDependencies.vitest,
  },
};

function projectAt(tree, root) {
  for (const [name, project] of getProjects(tree))
    if (project.root === root) return { name, project };
  throw new Error(`No project was generated in ${root}.`);
}

/**
 * The native component and its test, where the generator put its own component: in a folder of
 * its own under `src/lib` from `@nx/angular`, with an external template and stylesheet this
 * leaves out, or as `src/lib/<name>.ts` from `@nx/js`. `src/index.ts` already exports it.
 */
function replaceComponent(tree, project, file) {
  const lib = joinPathFragments(project.root, 'src', 'lib');
  const folder = tree.exists(joinPathFragments(lib, file, `${file}.ts`))
    ? joinPathFragments(lib, file)
    : lib;
  for (const extension of ['html', 'css', 'spec.ts']) {
    const own = joinPathFragments(folder, `${file}.${extension}`);
    if (tree.exists(own)) tree.delete(own);
  }
  writeComponent(tree, folder, file, project.prefix);
}

/**
 * A `tsconfig.spec.json` like the one each generator writes with its tests, including the tests
 * and the Vitest config. The tests import their component as `./ui.ts`, as the template's do.
 */
function writeSpecConfig(tree, root, angular) {
  const include = ['vitest.config.mts', 'src/**/*.test.ts'];
  const spec = angular
    ? {
        extends: './tsconfig.json',
        compilerOptions: { noEmit: true, allowImportingTsExtensions: true },
        include,
      }
    : {
        // A project reference of the TypeScript preset's, which emits declarations only.
        extends: readJson(tree, joinPathFragments(root, 'tsconfig.lib.json')).extends,
        compilerOptions: { outDir: './out-tsc/vitest', allowImportingTsExtensions: true },
        include,
        references: [{ path: './tsconfig.lib.json' }],
      };
  tree.write(joinPathFragments(root, 'tsconfig.spec.json'), JSON.stringify(spec, null, 2) + '\n');
  updateJson(tree, joinPathFragments(root, 'tsconfig.json'), (config) => {
    const references = config.references ?? [];
    if (!references.some((reference) => reference.path === './tsconfig.spec.json')) {
      references.push({ path: './tsconfig.spec.json' });
    }
    return { ...config, references };
  });
  updateJson(tree, joinPathFragments(root, 'tsconfig.lib.json'), (config) => {
    const exclude = config.exclude ?? [];
    if (!exclude.includes('src/**/*.test.ts')) exclude.push('src/**/*.test.ts');
    return { ...config, exclude };
  });
}

/**
 * Lets the library's source import as its test, the template and the documentation do, with
 * `.ts`: `allowImportingTsExtensions` in `tsconfig.lib.json`, and `src/index.ts` written that way
 * in place of the `.js` `@nx/js` gives it.
 *
 * TypeScript takes the option only where no JavaScript is emitted, which is the TypeScript
 * preset's own setting (`emitDeclarationOnly`, which `@nx/js` writes into `tsconfig.lib.json`). A
 * workspace that has turned that off keeps `.js`.
 */
function importWithTsExtensions(tree, root) {
  const config = joinPathFragments(root, 'tsconfig.lib.json');
  if (!emitsDeclarationsOnly(tree, config)) return;
  updateJson(tree, config, (lib) => ({
    ...lib,
    compilerOptions: { ...lib.compilerOptions, allowImportingTsExtensions: true },
  }));
  const index = joinPathFragments(root, 'src', 'index.ts');
  if (!tree.exists(index)) return;
  const source = tree.read(index, 'utf-8');
  tree.write(index, source.replace(/(from\s+['"]\.{1,2}\/[^'"]*)\.js(['"])/g, '$1.ts$2'));
}

/** Whether a tsconfig emits declarations and no JavaScript, once what it extends is merged in. */
function emitsDeclarationsOnly(tree, file) {
  const { noEmit, emitDeclarationOnly } = emitOptions(tree, file, new Set());
  return noEmit === true || emitDeclarationOnly === true;
}

/**
 * `noEmit` and `emitDeclarationOnly` as the compiler reads them: each from the nearest config that
 * sets it, and a later entry of an `extends` list over an earlier one.
 */
function emitOptions(tree, file, seen) {
  if (seen.has(file) || !tree.exists(file)) return {};
  // The configs on the way here, to stop at a cycle. Not every config read: two entries of a list
  // may share an ancestor, and each is read whole.
  const above = new Set(seen).add(file);
  const { compilerOptions = {}, extends: base = [] } = readJson(tree, file);
  // ponytail: a config that comes from a package is not followed, so a library under one keeps
  // `.js`. Resolve the specifier from the config's directory if a workspace needs it.
  const inherited = [base]
    .flat()
    .filter((from) => typeof from === 'string' && from.startsWith('.'))
    .map((from) => joinPathFragments(path.dirname(file), from))
    .map((from) => emitOptions(tree, from.endsWith('.json') ? from : `${from}.json`, above));
  const { noEmit, emitDeclarationOnly } = compilerOptions;
  return Object.assign(
    {},
    ...inherited,
    noEmit === undefined ? {} : { noEmit },
    emitDeclarationOnly === undefined ? {} : { emitDeclarationOnly },
  );
}

/**
 * The packages the component and its test import: in the library's own `package.json` when it is
 * a workspace package, which pnpm links from, and at the root otherwise. A version already there
 * is left alone.
 */
async function addImports(tree, root) {
  const manifest = joinPathFragments(root, 'package.json');
  const rootManifest = readJson(tree, 'package.json');
  if (tree.exists(manifest)) {
    const own = async (wanted) => asSaved(tree, native.reuseRootRanges(wanted, rootManifest));
    return addDependenciesToPackageJson(
      tree,
      await own(imports.dependencies),
      await own(imports.devDependencies),
      manifest,
      true,
    );
  }
  const existing = Object.keys({ ...rootManifest.dependencies, ...rootManifest.devDependencies });
  return addDependenciesToPackageJson(
    tree,
    await asSaved(tree, imports.dependencies, existing),
    await asSaved(tree, imports.devDependencies, existing),
    'package.json',
    true,
  );
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ directory: string, name?: string, tags?: string, skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function library(tree, options) {
  const directory = path.normalize(options.directory).replace(/\/$/, '');
  const { dependencies, devDependencies } = readJson(tree, 'package.json');
  const angular = Boolean({ ...dependencies, ...devDependencies }['@nx/angular']);
  const shared = { directory, name: options.name, tags: options.tags, unitTestRunner: 'none' };
  if (angular) await bases.angular(tree, { ...shared, skipFormat: true });
  else await bases.js(tree, { ...shared, bundler: 'none', skipFormat: true });

  const { name, project } = projectAt(tree, directory);
  const file = names(options.name ?? path.basename(directory)).fileName;
  replaceComponent(tree, project, file);

  const aliases = hasPathAliases(tree, usesWorkspaces(tree));
  tree.write(joinPathFragments(directory, 'vitest.config.mts'), native.vitestConfig(aliases));
  writeSpecConfig(tree, directory, angular);
  if (!angular) importWithTsExtensions(tree, directory);
  updateProjectConfiguration(tree, name, {
    ...project,
    targets: {
      ...project.targets,
      test: {
        executor: 'nx:run-commands',
        options: { cwd: directory, command: 'vitest run' },
        cache: true,
        inputs: ['default', '^production'],
      },
    },
  });

  await addImports(tree, directory);
  // `nxViteTsPaths()`, which the Vitest config uses to reach the workspace's other libraries.
  if (aliases) {
    const vite = { '@nx/vite': workspaceNxVersion(tree) };
    addDependenciesToPackageJson(tree, {}, vite, 'package.json', true);
  }

  if (!options.skipFormat) await formatFiles(tree);
  if (options.skipInstall) return () => {};
  return () => installPackagesTask(tree, true);
}

module.exports = { library, bases, generatorDefaults };
