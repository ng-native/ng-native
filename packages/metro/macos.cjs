/**
 * `macos` as a Metro platform: what the preset resolves and transforms differently for it.
 *
 * Expo SDK 58 already bundles `macos` (`npx expo export -p macos`), resolving each file `.macos`
 * first, then `.ios`, then `.native`, so React Native's own iOS files run on a Mac. What is left
 * for this preset:
 *
 * - Expo's packages are not in a desktop app. `expo/*` and every `expo-*` package resolve to an
 *   empty module, and `expo` itself to `macos/expo-runtime.js`, which brings what `import 'expo'`
 *   brought that the app relies on. Expo's own files keep their imports of each other: they are in
 *   the bundle only where Expo's config put them there, as the module a lazy `import()` loads.
 * - A file whose iOS behaviour is wrong for a Mac gets a hand-written override, listed in
 *   `OVERRIDES`. Only `Platform`, which reports `'macos'`.
 * - React Native's iOS branches are kept, and `Platform.select` answered for `macos`, by the Babel
 *   plugin in `macos-babel.cjs`, which the transformer runs ahead of the preset's.
 *
 * And Expo bundles `macos` only when `experiments.outOfTreePlatforms` is set, and drops it from
 * `expo export` without a word when it is not: `checkOutOfTreePlatforms` says so instead.
 */
const path = require('node:path');

const PLATFORM = 'macos';

/** What `import 'expo'` resolves to on macOS. */
const RUNTIME = require.resolve('./macos/expo-runtime.js');

/**
 * React Native's files whose iOS behaviour is wrong for a Mac, from the package's root, each with
 * the file a `macos` bundle takes in its place. The override imports the file it replaces, and
 * that import is left alone.
 */
const OVERRIDES = new Map([
  [
    ['Libraries', 'Utilities', 'Platform.ios.js'].join(path.sep),
    require.resolve('./macos/Platform.macos.js'),
  ],
]);

const OWN_OVERRIDES = new Set(OVERRIDES.values());

const EXPO_REQUEST = /^(expo(\/|$)|expo-)/;

/** A file inside Expo's own packages, whose imports of each other are kept. */
const EXPO_FILE = /[\\/]node_modules[\\/](expo|expo-[^\\/]+|@expo[\\/][^\\/]+)[\\/]/;

/**
 * What `name` resolves to in a `macos` bundle where that differs from Metro's answer, or nothing.
 *
 * @param {{ originModulePath?: string }} context
 * @param {string} name
 * @param {string | null} platform
 * @param {ReadonlySet<string>} kept requests Expo's config adds to every bundle, such as the module
 *   a lazy `import()` loads, which resolve as they would anywhere else
 */
function macosRequest(context, name, platform, kept) {
  if (platform !== PLATFORM || !EXPO_REQUEST.test(name)) return undefined;
  const from = context.originModulePath ?? '';
  if (from === RUNTIME || kept.has(name)) return undefined;
  if (name === 'expo') return { type: 'sourceFile', filePath: RUNTIME };
  if (EXPO_FILE.test(from)) return undefined;
  return { type: 'empty' };
}

/**
 * The context the runtime's and the overrides' own imports resolve in: the app's, since `expo` and
 * `react-native` are the app's dependencies and not this package's. Any other context as it was.
 *
 * @template {{ originModulePath?: string }} C
 * @param {C} context
 * @param {string | undefined} projectRoot
 * @returns {C}
 */
function runtimeContext(context, projectRoot) {
  const from = context.originModulePath;
  if (!projectRoot || (from !== RUNTIME && !OWN_OVERRIDES.has(from ?? ''))) return context;
  return { ...context, originModulePath: path.join(projectRoot, 'package.json') };
}

/**
 * The override a `macos` bundle takes in place of a resolved React Native file, or the resolution
 * as it was.
 *
 * @template {{ type?: string, filePath?: string } | null | undefined} R
 * @param {R} resolution
 * @param {{ originModulePath?: string }} context
 * @param {string | null} platform
 * @returns {R | { type: 'sourceFile', filePath: string }}
 */
function macosOverride(resolution, context, platform) {
  const file = resolution?.type === 'sourceFile' ? resolution.filePath : undefined;
  if (platform !== PLATFORM || !file) return resolution;
  for (const [replaced, override] of OVERRIDES) {
    const marker = `${path.sep}react-native${path.sep}${replaced}`;
    if (file.endsWith(marker) && context.originModulePath !== override) {
      return { type: 'sourceFile', filePath: override };
    }
  }
  return resolution;
}

/**
 * The transformer's params with the macOS Babel plugin added, for a `macos` bundle, or as they were.
 *
 * @template {{ options?: { platform?: string | null }, plugins?: unknown[] }} P
 * @param {P} params
 * @returns {P}
 */
function withMacosPlugins(params) {
  if (params.options?.platform !== PLATFORM) return params;
  return { ...params, plugins: [...(params.plugins ?? []), require('./macos-babel.cjs')] };
}

/** The platform an `expo` command was asked for, from its arguments, or nothing. */
function requestedPlatforms(argv) {
  const asked = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = /^(?:--platform|-p)=(.+)$/.exec(arg);
    if (inline) asked.push(inline[1]);
    else if ((arg === '--platform' || arg === '-p') && argv[i + 1]) asked.push(argv[++i]);
  }
  return asked;
}

/**
 * Throws when the app asks for `macos` and Expo would quietly leave it out: `expo.platforms` lists
 * `macos`, or the command was given `-p macos`, and `experiments.outOfTreePlatforms` is not set.
 * Without the flag Expo's config drops every platform but iOS, Android and web, so `expo export -p
 * macos` writes nothing for it and says nothing.
 *
 * @param {{ platforms?: string[], experiments?: { outOfTreePlatforms?: boolean } } | undefined} expo
 *   the app's `expo` config
 * @param {readonly string[]} [argv] the command's arguments
 */
function checkOutOfTreePlatforms(expo, argv = process.argv) {
  if (!expo || expo.experiments?.outOfTreePlatforms === true) return;
  const listed = Array.isArray(expo.platforms) && expo.platforms.includes(PLATFORM);
  if (!listed && !requestedPlatforms(argv).includes(PLATFORM)) return;
  throw new Error(
    '[angular-native] macOS needs "experiments": { "outOfTreePlatforms": true } in app.json\'s ' +
      '"expo" config. Without it Expo leaves macos out of every bundle and export, and says nothing.',
  );
}

/**
 * The app's `expo` config, as the Expo CLI reads it, or nothing where it cannot be read: a project
 * with no Expo config, or a config that throws, which the Expo CLI reports itself.
 *
 * @param {string | undefined} projectRoot
 */
function expoConfig(projectRoot) {
  if (!projectRoot) return undefined;
  try {
    const from = { paths: [projectRoot] };
    const { getConfig } = require(require.resolve('expo/config', from));
    return getConfig(projectRoot, { skipSDKVersionRequirement: true, skipPlugins: true }).exp;
  } catch {
    return undefined;
  }
}

module.exports = {
  macosRequest,
  macosOverride,
  runtimeContext,
  withMacosPlugins,
  checkOutOfTreePlatforms,
  expoConfig,
  requestedPlatforms,
};
