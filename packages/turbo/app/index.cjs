/**
 * `turbo gen ng-native-app`: an Angular Native app as a package of this workspace.
 *
 * The app is the template's, as `create-expo-app --template @ng-native/template` makes it, named
 * for the workspace and given the scripts `turbo run` runs: `dev` and `build` beside the
 * template's `start`, `ios`, `android`, `test` and `typecheck`. It lists its dependencies itself,
 * as every workspace package does, which pnpm needs in order to link them and Expo's autolinking in
 * order to link their native code.
 *
 * Its `typecheck` reads `tsconfig.typecheck.json`: the app's libraries are the package manager's
 * links, and pnpm gives a library a copy of its own of a package whose peers it does not share with
 * the app. `ngc` given both copies stops at `NG3004` before it checks a template.
 */
const path = require('node:path').posix;
const native = require('../native-app.cjs');
const { asSaved } = require('@ng-native/migrate/save-exact.cjs');
const { includeInWorkspaces } = require('@ng-native/migrate/workspace-globs.cjs');
const {
  commandsFor,
  metroPort,
  packageManager,
  packageName: packageNameOf,
} = require('../workspace.cjs');

/** @typedef {ReturnType<typeof import('../files.cjs').workspaceFiles>} Files */

/**
 * @typedef {object} AppOptions
 * @property {string} directory where the app goes, from the workspace root: `apps/mobile`
 * @property {'eslint' | 'none'} [linter]
 */

/**
 * Where the app goes and what it is called: its directory's name, under the workspace's scope, as
 * `create-turbo` names its own packages, and `com.<scope>.<name>` for iOS and Android, made valid
 * for both.
 *
 * @param {Files} files
 * @param {AppOptions} options
 */
function names(files, options) {
  const directory = normalize(options.directory);
  const { name, workspaceScope, packageName } = packageNameOf(files, directory);
  const bundleIdentifier = native.bundleIdentifier(name, workspaceScope);
  return { directory, name, packageName, bundleIdentifier, lint: options.linter === 'eslint' };
}

/** A directory as the workspace's globs name it: relative, with `/`, and no trailing slash. */
function normalize(directory) {
  const clean = path.normalize(directory.trim().replace(/\\/g, '/')).replace(/\/$/, '');
  if (!clean || clean === '.' || clean.startsWith('..') || path.isAbsolute(clean)) {
    throw new Error(
      `${directory} is not a directory inside the workspace: give one like apps/mobile.`,
    );
  }
  return clean;
}

/**
 * What the app lists: the root's version of a package the root already has, where the app can use
 * it, and its own otherwise, exact if the workspace saves exact versions.
 *
 * @param {Files} files
 * @param {Record<string, string>} wanted
 */
async function appDependencies(files, wanted) {
  const root = files.readJson('package.json') ?? {};
  const pinned = native.reuseRootRanges(wanted, root);
  const installed = { ...root.devDependencies, ...root.dependencies };
  const settled = Object.keys(wanted).filter((pkg) => pinned[pkg] === installed[pkg]);
  return asSaved(files, pinned, settled);
}

/** The Commands section of the app's `AGENTS.md`, as this workspace runs them. */
function commands(manager, name, lint) {
  const run = commandsFor(manager);
  const rows = [
    [
      run.script(name, 'start'),
      'Metro; press i or a for a simulator, or scan the QR code with Expo Go',
    ],
    [run.script(name, 'ios'), 'Metro, opening the app on the iOS simulator'],
    [run.script(name, 'android'), 'Metro, opening the app on the Android emulator'],
    [run.turbo('test', name), 'Vitest, in Node against a fake native layer: no simulator needed'],
    [run.turbo('typecheck', name), 'TypeScript and the templates, without emitting'],
    ...(lint
      ? [[run.turbo('lint', name), 'ESLint: what compiles but does nothing on a device']]
      : []),
    [run.turbo('build', name), 'expo export of the iOS and Android bundles into dist/'],
  ];
  const width = Math.max(...rows.map(([command]) => command.length)) + 2;
  const checks = [run.turbo('test', name), run.turbo('typecheck', name)];
  if (lint) checks.push(run.turbo('lint', name));
  const quoted = checks.map((check) => `\`${check}\``);
  return [
    '```sh',
    ...rows.map(([command, what]) => `${command.padEnd(width)}# ${what}`),
    '```',
    '',
    '`src/main.ts` mounts the root component, `src/app/app.ts`. ' +
      `Run ${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)} after a change; ` +
      (lint ? 'all three are fast.' : 'both are fast.'),
  ].join('\n');
}

/** Expo's cache directory, in the workspace's `.gitignore`, once. */
function ignoreExpo(files) {
  if (!files.exists('.gitignore')) return;
  const ignore = files.read('.gitignore') ?? '';
  if (/^\/?\.expo\/?$/m.test(ignore)) return;
  files.write('.gitignore', ignore.replace(/\n*$/, '\n\n# Expo\n.expo/\n'));
}

/**
 * @param {Files} files
 * @param {AppOptions} options
 * @returns {Promise<string>} what was done, for the generator's summary
 */
async function app(files, options) {
  const resolved = names(files, options);
  const { directory, packageName, bundleIdentifier, lint } = resolved;
  if (files.exists(`${directory}/package.json`)) {
    throw new Error(`${directory} already has a package.json. Choose another directory.`);
  }
  const manager = packageManager(files);
  const port = metroPort(files, native.DEFAULT_PORT);
  includeInWorkspaces(files, directory);

  const file = (name, content) => files.write(`${directory}/${name}`, content);
  for (const name of native.SOURCE_FILES) file(name, native.sourceFile(name));
  file('app.json', native.appJson(packageName, bundleIdentifier));
  file('AGENTS.md', native.agentsFile(commands(manager, packageName, lint)));
  file('CLAUDE.md', '@AGENTS.md\n');
  file('.gitignore', `${native.GITIGNORE}\n# expo export, which the build script runs\n/dist\n`);
  file('tsconfig.typecheck.json', JSON.stringify(native.typecheckTsconfig(), null, 2) + '\n');
  file('turbo.json', JSON.stringify(native.TURBO_JSON, null, 2) + '\n');
  if (lint) file('eslint.config.mjs', native.ESLINT_CONFIG);

  const dev = lint
    ? { ...native.devDependencies, ...native.lintDevDependencies }
    : native.devDependencies;
  const manifest = {
    name: packageName,
    version: '0.0.1',
    private: true,
    main: 'src/main.ts',
    scripts: native.scripts(port, lint),
    dependencies: await appDependencies(files, native.dependencies),
    devDependencies: await appDependencies(files, dev),
  };
  file('package.json', JSON.stringify(manifest, null, 2) + '\n');
  ignoreExpo(files);

  const run = commandsFor(manager);
  return (
    `Created ${directory}. Run ${run.install}, then ${run.script(packageName, 'start')} for Metro, ` +
    `and ${run.turbo('test', packageName)} or ${run.turbo('typecheck', packageName)}.` +
    (port === native.DEFAULT_PORT ? '' : ` Its Metro listens on ${port}, beside the other apps.`)
  );
}

module.exports = { app };
