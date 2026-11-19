/**
 * `linux` as a platform Expo's tooling knows.
 *
 * Expo SDK 58 has a closed list of platforms, in `@expo/platforms`: `expo export -p linux` is
 * refused, and the first resolver of Expo's Metro config throws on a `platform=linux` request
 * (`getSupportPackageForPlatform` in `expo-modules-autolinking` has no `linux` case).
 * `registerLinux` adds `linux` to that data, in memory, as an out-of-tree platform whose files
 * resolve `.linux`, then `.ios`, then `.native`, with React Native itself as its host package: Linux
 * takes React Native's iOS files, as macOS does. No file in `node_modules` changes.
 *
 * The Metro preset calls it for an app whose `expo.platforms` lists `linux`. `expo export` checks
 * the platform before it loads the Metro config, so an app that exports for Linux calls it from
 * `app.config.js` as well:
 *
 * ```js
 * require('@ng-native/metro/linux.cjs').registerLinux(__dirname);
 * module.exports = ({ config }) => config;
 * ```
 */
const path = require('node:path');

/**
 * What `expo-modules-autolinking resolve --platform linux` needs of a platform: the module's root
 * and its `linux` entry from `expo-module.config.json`. The desktop host links native code with its
 * own `autolink.mjs`, so this answers only Expo's commands.
 */
const LINUX_LINKING = {
  resolveModuleAsync: async (packageName, revision) => ({
    packageName,
    packageRoot: revision.path,
    linux: revision.config?.rawConfig?.linux ?? null,
  }),
  resolveExtraBuildDependenciesAsync: async () => null,
};

/** Marks an autolinking module's exports as already answering `linux`. */
const PATCHED = Symbol.for('ng-native.linux');

/**
 * The copies of Expo's modules the CLI the app runs reads, resolved from the app's own `expo`, so
 * under pnpm the ones changed are the ones in use.
 *
 * @param {string} projectRoot
 * @param {NodeJS.Require} load
 */
function expoModules(projectRoot, load) {
  const expoDir = path.dirname(load.resolve('expo/package.json', { paths: [projectRoot] }));
  const near = { paths: [expoDir] };
  const cliDir = path.dirname(load.resolve('@expo/cli/package.json', near));
  return {
    platforms: load.resolve('@expo/platforms', { paths: [cliDir] }),
    autolinking: ['platforms/index', 'exports'].map((file) =>
      load.resolve(`expo-modules-autolinking/build/${file}`, near),
    ),
    outer: load.resolve('expo-modules-autolinking/exports', near),
  };
}

/**
 * `@expo/platforms`, checked to have the lists Expo SDK 58 has.
 *
 * @param {string} file
 * @param {NodeJS.Require} load
 */
function platformLists(file, load) {
  const platforms = load(file);
  const lists = [platforms.KNOWN_PLATFORMS, platforms.OUT_OF_TREE_PLATFORMS];
  const maps = [platforms.PLATFORM_EXTENSIONS, platforms.REACT_NATIVE_HOST_PACKAGES];
  if (!lists.every(Array.isArray) || !maps.every((map) => typeof map === 'object' && map)) {
    throw new Error(
      `[angular-native] @expo/platforms (${file}) does not have the platform lists Expo SDK 58 ` +
        'has, so linux cannot be added to them. Check that @ng-native/metro supports the Expo SDK ' +
        'the app is on.',
    );
  }
  return platforms;
}

/**
 * Replaces the cached exports of one of `expo-modules-autolinking`'s modules with a copy whose
 * `getSupportPackageForPlatform` and `getLinkingImplementationForPlatform` answer `linux`. Both
 * are closed switches behind getters that cannot be redefined.
 *
 * @param {string} file
 * @param {NodeJS.Require} load
 */
function answerLinux(file, load) {
  const original = load(file);
  if (original[PATCHED]) return;
  const support = original.getSupportPackageForPlatform;
  if (typeof support !== 'function') {
    throw new Error(
      `[angular-native] ${file} has no getSupportPackageForPlatform, which Expo SDK 58's Metro ` +
        'config calls for every platform. Check that @ng-native/metro supports the Expo SDK the ' +
        'app is on.',
    );
  }
  const patched = { ...original, __esModule: original.__esModule, [PATCHED]: true };
  patched.getSupportPackageForPlatform = (platform) =>
    platform === 'linux' ? 'react-native' : support(platform);
  const linking = original.getLinkingImplementationForPlatform;
  if (typeof linking === 'function') {
    patched.getLinkingImplementationForPlatform = (platform) =>
      platform === 'linux' ? LINUX_LINKING : linking(platform);
  }
  // Loaded on the first line, so it is in the cache.
  /** @type {NodeJS.Module} */ (load.cache[file]).exports = patched;
}

/**
 * Teaches the Expo tooling the app uses a `linux` platform. Idempotent. Throws when Expo's data is
 * not laid out as Expo SDK 58 lays it out, since the platform would then be refused, or bundled with
 * the wrong files, somewhere later and less clearly.
 *
 * @param {string} projectRoot the app's root, where its `expo` resolves from
 * @param {NodeJS.Require} [load] the `require` to read Expo's modules with
 */
function registerLinux(projectRoot, load = require) {
  const files = expoModules(projectRoot, load);
  const platforms = platformLists(files.platforms, load);
  for (const list of [platforms.KNOWN_PLATFORMS, platforms.OUT_OF_TREE_PLATFORMS]) {
    if (!list.includes('linux')) list.push('linux');
  }
  platforms.PLATFORM_EXTENSIONS.linux = ['linux', 'ios', 'native'];
  platforms.REACT_NATIVE_HOST_PACKAGES.linux = 'react-native';
  // Autolinking's own resolver reads the answers through `./platforms`, Expo's Metro config through
  // the exports file.
  for (const file of files.autolinking) answerLinux(file, load);
  // The package's entry re-exports the build's, and was read before the line above if anything
  // had loaded it already.
  const outer = load.cache[files.outer];
  if (outer) outer.exports = load(files.autolinking[1]);
}

/**
 * Whether the app asks for `linux`: its `expo.platforms` lists it, or the command names it.
 *
 * @param {{ platforms?: string[] } | undefined} expo the app's `expo` config
 * @param {readonly string[]} asked the platforms the command was given
 */
const asksForLinux = (expo, asked) =>
  (Array.isArray(expo?.platforms) && expo.platforms.includes('linux')) || asked.includes('linux');

module.exports = { registerLinux, asksForLinux };
