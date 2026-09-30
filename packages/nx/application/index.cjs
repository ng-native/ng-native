/**
 * `nx g @ng-native/nx:app apps/mobile`: an Angular Native app as a project of this workspace.
 *
 * The app is an Expo project, built by Metro. `@nx/expo`'s plugin, which `init` registers, infers
 * its Expo targets from the files written here; `project.json` adds the two it cannot infer:
 * `typecheck`, since Expo's `tsconfig` sets `noEmit` and `@nx/js` disables its own for that, and
 * `test`, which runs Vitest once rather than watching. It also replaces the inferred `start`,
 * which is `@nx/expo:start`, an executor Nx deprecates and warns about on every run, with the
 * `expo start` that executor runs, as the plugin already infers `run-ios` and `export`. Once the
 * plugin infers `start` as a command too, this one can go.
 *
 * Where the dependencies go depends on the workspace. With package-manager workspaces, the Nx
 * default since 20, the app is a workspace package and lists them itself, which pnpm needs in
 * order to link them. In an integrated workspace, with one root `package.json`, they go there.
 */
const path = require('node:path').posix;
const {
  formatFiles,
  joinPathFragments,
  logger,
  offsetFromRoot,
  readJson,
  runTasksInSerial,
  addProjectConfiguration,
  installPackagesTask,
  addDependenciesToPackageJson,
} = require('@nx/devkit');
const native = require('../native-app.cjs');
const { init, workspaceNxVersion } = require('../init/index.cjs');
const { usesWorkspaces, includeInWorkspaces } = require('./workspaces.cjs');

function names(tree, options) {
  const directory = path.normalize(options.directory).replace(/\/$/, '');
  const name = options.name ?? path.basename(directory);
  const scope = readJson(tree, 'package.json').name?.match(/^@[^/]+/)?.[0];
  const workspaces = usesWorkspaces(tree);
  // A workspace package is named for the workspace's scope, as Nx names its own.
  const projectName = workspaces && scope ? `${scope}/${name}` : name;
  return { directory, name, projectName, workspaces };
}

/**
 * Whether the workspace's `tsconfig.base.json` is where its libraries' path aliases live, or will.
 * With package-manager workspaces, only when it has a `paths` list, as the `angular-monorepo`
 * preset's does: the TypeScript preset's has none, and its libraries are packages linked instead.
 */
function hasPathAliases(tree, workspaces) {
  if (!tree.exists('tsconfig.base.json')) return false;
  return !workspaces || 'paths' in baseCompilerOptions(tree);
}

/**
 * The compiler options `file` ends up with, those it inherits through `extends` included, as
 * TypeScript merges them: each option from the last config that sets it.
 */
function baseCompilerOptions(tree, file = 'tsconfig.base.json', ancestors = []) {
  if (ancestors.includes(file) || !tree.exists(file)) return {};
  const config = readJson(tree, file);
  const inherited = [config.extends ?? []]
    .flat()
    .map((parent) => extendedFile(tree, path.dirname(file), parent))
    .filter(Boolean)
    .map((parent) => baseCompilerOptions(tree, parent, [...ancestors, file]));
  return Object.assign({}, ...inherited, config.compilerOptions);
}

/**
 * The file an `extends` entry in `directory` names: a path, or a package in a `node_modules` from
 * `directory` up, where a workspace's own shared-config package is linked. A bare package name
 * means its `tsconfig.json`.
 */
function extendedFile(tree, directory, parent) {
  const withJson = (file) => (tree.exists(file) || file.endsWith('.json') ? file : `${file}.json`);
  if (/^\.\.?\//.test(parent)) return withJson(path.join(directory, parent));
  const bare = /^(@[^/]+\/)?[^/]+$/.test(parent);
  for (let dir = directory; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', parent);
    const found = bare ? path.join(file, 'tsconfig.json') : withJson(file);
    if (tree.exists(found)) return found;
    if (dir === '.' || dir === '/') return undefined;
  }
}

function targets(directory) {
  const run = (command) => ({ executor: 'nx:run-commands', options: { cwd: directory, command } });
  return {
    typecheck: {
      ...run('ngc -p tsconfig.json --noEmit'),
      cache: true,
      inputs: ['default', '^production'],
    },
    test: { ...run('vitest run'), cache: true, inputs: ['default', '^production'] },
    start: { ...run('expo start'), continuous: true },
  };
}

/** The Commands section of the app's `AGENTS.md`, as this workspace runs them. */
function commands(name) {
  const rows = [
    [`nx start ${name}`, 'Metro; press i or a for a simulator, or scan the QR code with Expo Go'],
    [`nx run ${name}:run-ios`, 'the iOS simulator'],
    [`nx run ${name}:run-android`, 'the Android emulator'],
    [`nx test ${name}`, 'Vitest, in Node against a fake native layer: no simulator needed'],
    [`nx typecheck ${name}`, 'TypeScript, without emitting'],
  ];
  const width = Math.max(...rows.map(([command]) => command.length)) + 2;
  return [
    '```sh',
    ...rows.map(([command, what]) => `${command.padEnd(width)}# ${what}`),
    '```',
    '',
    '`src/main.ts` mounts the root component, `src/app/app.ts`. ' +
      `Run \`nx test ${name}\` and \`nx typecheck ${name}\` after a change; both are fast.`,
  ].join('\n');
}

function writeFiles(tree, { directory, projectName, workspaces }) {
  const file = (name, content) => tree.write(joinPathFragments(directory, name), content);
  for (const name of native.SOURCE_FILES) file(name, native.sourceFile(name));
  file('app.json', native.appJson(projectName));
  file('AGENTS.md', native.agentsFile(commands(projectName)));
  file('CLAUDE.md', '@AGENTS.md\n');
  file('metro.config.js', native.METRO_CONFIG);

  const base = hasPathAliases(tree, workspaces);
  const workspaceBase = base ? `${offsetFromRoot(directory)}tsconfig.base.json` : undefined;
  const conditions = baseCompilerOptions(tree).customConditions ?? [];
  file('tsconfig.json', JSON.stringify(native.tsconfig(workspaceBase, conditions), null, 2) + '\n');
  file('vitest.config.mts', native.vitestConfig(Boolean(base)));

  const manifest = { name: projectName, version: '0.0.1', private: true, main: 'src/main.ts' };
  if (workspaces) {
    const root = readJson(tree, 'package.json');
    Object.assign(manifest, {
      dependencies: native.reuseRootRanges(native.dependencies, root),
      devDependencies: native.reuseRootRanges(native.devDependencies, root),
    });
  } else {
    manifest.dependencies = native.prebuildPins(readJson(tree, 'package.json'));
  }
  file('package.json', JSON.stringify(manifest, null, 2) + '\n');
}

/** Expo's cache directory, once. */
function ignoreExpo(tree) {
  if (!tree.exists('.gitignore')) return;
  const ignore = tree.read('.gitignore', 'utf-8') ?? '';
  if (/^\.expo\/?$/m.test(ignore)) return;
  tree.write('.gitignore', ignore.replace(/\n*$/, '\n\n# Expo\n.expo/\n'));
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ directory: string, name?: string, tags?: string, skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function application(tree, options) {
  const resolved = names(tree, options);
  const { directory, projectName, workspaces } = resolved;
  if (tree.exists(joinPathFragments(directory, 'package.json'))) {
    throw new Error(`${directory} already has a package.json. Choose another directory.`);
  }
  const initTask = await init(tree, { skipInstall: true, skipFormat: true });

  if (workspaces) {
    includeInWorkspaces(tree, directory);
  } else {
    for (const problem of native.conflicts(readJson(tree, 'package.json'))) logger.warn(problem);
    addDependenciesToPackageJson(
      tree,
      native.dependencies,
      native.devDependencies,
      'package.json',
      true,
    );
  }
  // `nxViteTsPaths()`, which the app's Vitest config uses to reach the workspace's libraries.
  // Added now rather than only when present, because a library generated later is the ordinary
  // case and nothing would come back to add it then.
  if (hasPathAliases(tree, workspaces)) {
    const vite = { '@nx/vite': workspaceNxVersion(tree) };
    addDependenciesToPackageJson(tree, {}, vite, 'package.json', true);
  }
  writeFiles(tree, resolved);
  addProjectConfiguration(tree, projectName, {
    root: directory,
    sourceRoot: directory,
    projectType: 'application',
    tags: (options.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    targets: targets(directory),
  });

  ignoreExpo(tree);

  if (!options.skipFormat) await formatFiles(tree);
  logger.info(
    `Created ${directory}. nx start ${projectName} runs Metro; nx run ${projectName}:run-ios, ` +
      `nx test ${projectName}, nx typecheck ${projectName}, nx export ${projectName}.`,
  );
  if (options.skipInstall) return initTask;
  return runTasksInSerial(initTask, () => installPackagesTask(tree, true));
}

module.exports = { application };
