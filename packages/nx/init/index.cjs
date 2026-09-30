/**
 * `nx add @ng-native/nx`, and the first step of every app generated here.
 *
 * An Angular Native app is an Expo app, so its targets are Expo's, and `@nx/expo`'s plugin already
 * infers them from any project with an `app.json`, a `metro.config.js` and a `package.json`:
 * `start`, `run-ios`, `run-android`, `export`, `prebuild`, and EAS `build` and `submit`. This adds
 * `@nx/expo` at the workspace's own Nx version and registers that plugin.
 *
 * It does not run `@nx/expo:init`, which installs Expo itself at the SDK `@nx/expo` was released
 * against. On Nx 23.2 that is SDK 56, with `@expo/cli` 56 and a `react-dom` that asks for React
 * 19.3, and an Angular Native app needs SDK 57 and React 19.2.3: npm refuses the install.
 *
 * Two things `init` would have added, it adds itself at the versions the app needs. `react-dom`,
 * because `@nx/expo` depends on `@nx/react`, whose `react-dom` peer npm otherwise takes at the
 * newest React and then refuses every later install beside React 19.2.3. And `@expo/cli`, which
 * `@nx/expo`'s prebuild executor loads from the root, where npm does not put it on its own.
 *
 * It also adds Babel 7's `@babel/runtime`, the one Expo's Babel preset writes imports of. In an
 * Angular workspace `@angular-devkit/build-angular` hoists Babel 8's to the root, which has no
 * `regenerator`, and every `nx start` warned that Metro fell back to file-based resolution. And
 * Babel 7's `@babel/core`, which every plugin in that preset peers on, and which the same hoisted
 * Babel 8 otherwise answers.
 */
const {
  addDependenciesToPackageJson,
  formatFiles,
  readJson,
  readNxJson,
  updateNxJson,
  NX_VERSION,
} = require('@nx/devkit');
const semver = require('semver');
const native = require('../native-app.cjs');
const { usesWorkspaces } = require('../application/workspaces.cjs');
const { asSaved, savesExact } = require('../save-exact.cjs');

/** The plugin entry `@nx/expo:init` itself writes, so the target names are the ones Nx documents. */
const EXPO_PLUGIN = {
  plugin: '@nx/expo/plugin',
  options: {
    startTargetName: 'start',
    buildTargetName: 'build',
    prebuildTargetName: 'prebuild',
    serveTargetName: 'serve',
    installTargetName: 'install',
    exportTargetName: 'export',
    submitTargetName: 'submit',
    runIosTargetName: 'run-ios',
    runAndroidTargetName: 'run-android',
    buildDepsTargetName: 'build-deps',
    watchDepsTargetName: 'watch-deps',
  },
};

/**
 * The Nx this workspace installed, which every `@nx/*` package in it has to match: the version
 * running now when the workspace saves exact versions and lists Nx at a range, rather than the
 * newest the range allows, which may not be the one installed.
 */
function workspaceNxVersion(tree) {
  const manifest = readJson(tree, 'package.json');
  const nx = manifest.devDependencies?.nx ?? manifest.dependencies?.nx ?? NX_VERSION;
  const running = !semver.valid(nx) && savesExact(tree) && semver.satisfies(NX_VERSION, nx);
  return running ? NX_VERSION : nx;
}

function registerExpoPlugin(tree) {
  const nxJson = readNxJson(tree) ?? {};
  const plugins = nxJson.plugins ?? [];
  const registered = plugins.some(
    (entry) => (typeof entry === 'string' ? entry : entry.plugin) === EXPO_PLUGIN.plugin,
  );
  if (registered) return;
  updateNxJson(tree, { ...nxJson, plugins: [...plugins, EXPO_PLUGIN] });
}

/**
 * What goes beside `@nx/expo` at the root. With package-manager workspaces the app's own
 * `package.json` lists Expo, React and React Native, and the root lists none of them, so pnpm
 * resolves `@nx/expo`'s `expo` peer, and that Expo's own peers, in the root's context at the
 * newest versions there are: a second React Native and React in the lockfile. Pinning them here
 * at the app's versions makes the root's copies the app's. `react-dom` stays for `@nx/react`'s
 * peer, which needs a React beside it. `@expo/cli` is left out: `@nx/expo` runs the CLI through
 * `expo/bin/cli`, and `@expo/cli` peers on Expo and React Native too.
 */
function rootDependencies(tree) {
  if (!usesWorkspaces(tree)) return native.expoCompanions;
  const { '@expo/cli': _cli, ...companions } = native.expoCompanions;
  const { expo, react, 'react-native': reactNative } = native.dependencies;
  return { ...companions, expo, react, 'react-native': reactNative };
}

/**
 * The dependencies of `@nx/expo` with an install script, through `@nx/jest`. Both ship prebuilt
 * binaries for every platform, and the script only builds from source when one is missing, so
 * they are declined rather than allowed. pnpm 11 refuses to install until each one is decided,
 * with `ERR_PNPM_IGNORED_BUILDS`.
 */
const DECLINED_BUILDS = ['@parcel/watcher', 'unrs-resolver'];

const PNPM = 'pnpm-workspace.yaml';

/**
 * `allowBuilds`' entries with `name` declined, unless it is already `true` or `false`.
 *
 * @param {string} entries
 * @param {string} name
 */
function decline(entries, name) {
  const key = name.startsWith('@') ? `'${name}'` : name;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^([ \\t]+)['"]?${escaped}['"]?:[ \\t]*(.*)$`, 'm');
  const found = line.exec(entries);
  if (!found) return `${entries && entries.replace(/\n?$/, '\n')}  ${key}: false\n`;
  if (/^(true|false)\b/.test(found[2])) return entries;
  return entries.replace(line, `$1${key}: false`);
}

/**
 * Decides the builds above in `pnpm-workspace.yaml`'s `allowBuilds`, which pnpm 10.26 and later
 * read. A decision the workspace already made stays, and the placeholder pnpm writes after refusing
 * an install is settled. A workspace without pnpm is left alone.
 */
function declineBuilds(tree) {
  if (!tree.exists(PNPM) && !tree.exists('pnpm-lock.yaml')) return;
  const yaml = tree.read(PNPM, 'utf-8') ?? '';
  const block = /^allowBuilds:[ \t]*\n((?:[ \t]+.*(?:\n|$))*)/m.exec(yaml);
  const entries = DECLINED_BUILDS.reduce(decline, block?.[1] ?? '');
  const allowBuilds = `allowBuilds:\n${entries}`;
  if (block) tree.write(PNPM, yaml.replace(block[0], allowBuilds));
  else tree.write(PNPM, yaml ? `${yaml.replace(/\n*$/, '\n')}\n${allowBuilds}` : allowBuilds);
}

/**
 * @param {import('@nx/devkit').Tree} tree
 * @param {{ skipInstall?: boolean, skipFormat?: boolean }} options
 */
async function init(tree, options = {}) {
  registerExpoPlugin(tree);
  declineBuilds(tree);
  const { dependencies, devDependencies } = readJson(tree, 'package.json');
  const existing = Object.keys({ ...dependencies, ...devDependencies });
  const companions = await asSaved(tree, rootDependencies(tree), existing);
  const install = addDependenciesToPackageJson(
    tree,
    {},
    { '@nx/expo': workspaceNxVersion(tree), ...companions },
    'package.json',
    true,
  );
  if (!options.skipFormat) await formatFiles(tree);
  return options.skipInstall ? () => {} : install;
}

module.exports = { init, workspaceNxVersion, EXPO_PLUGIN };
