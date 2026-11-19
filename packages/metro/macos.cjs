/**
 * The desktop OSes as Metro platforms, `macos` and `linux`: what the preset resolves and transforms
 * differently for them. Both take React Native's iOS files, which the desktop host implements.
 *
 * Expo SDK 58 already bundles `macos` (`npx expo export -p macos`), resolving each file `.macos`
 * first, then `.ios`, then `.native`, so React Native's own iOS files run on a Mac. It does not
 * know `linux` at all: `linux.cjs` teaches it, and a `linux` bundle resolves `.linux`, then `.ios`,
 * then `.native` the same way. What is left for this preset, on each desktop OS:
 *
 * - Expo's packages are not in a desktop app. `expo/*` and every `expo-*` package resolve to an
 *   empty module, and `expo` itself to `macos/expo-runtime.js`, which brings what `import 'expo'`
 *   brought that the app relies on. Expo's own files keep their imports of each other: they are in
 *   the bundle only where Expo's config put them there, as the module a lazy `import()` loads.
 *   `expo/virtual/env`, which babel-preset-expo imports in dev for `process.env.EXPO_PUBLIC_*`,
 *   resolves too.
 * - A file whose iOS behaviour is wrong for a Mac gets a hand-written override, listed in
 *   `OVERRIDES`: `Platform`, which reports the desktop OS, and `resolveAssetSource`, which finds an
 *   Expo update's assets by file hash, as `expo-asset` does where Expo runs.
 * - React Native's iOS branches are kept, and `Platform.select` answered for the desktop OS, by the
 *   Babel plugin in `macos-babel.cjs`, which the transformer runs ahead of the preset's.
 *
 * And Expo bundles a desktop OS only when `experiments.outOfTreePlatforms` is set, and drops it from
 * `expo export` without a word when it is not: `checkOutOfTreePlatforms` says so instead.
 */
const path = require('node:path');

/** The desktop OSes this preset serves, each of which takes React Native's iOS files. */
const DESKTOP_PLATFORMS = new Set(['macos', 'linux']);

/**
 * Whether `platform` is one of the desktop OSes.
 *
 * @param {string | null | undefined} platform
 * @returns {platform is 'macos' | 'linux'}
 */
const isDesktop = (platform) => DESKTOP_PLATFORMS.has(platform ?? '');

/** What a desktop OS is called in a message. */
const DESKTOP_NAMES = { macos: 'macOS', linux: 'Linux' };

/**
 * What `import 'expo'` resolves to on each desktop OS. Linux's installs the `Intl` polyfills first,
 * since its Hermes is built without `Intl`, then everything macOS's does.
 */
const RUNTIMES = {
  macos: require.resolve('./macos/expo-runtime.js'),
  linux: require.resolve('./macos/expo-runtime.linux.js'),
};
const OWN_RUNTIMES = new Set(Object.values(RUNTIMES));

/**
 * React Native's files whose iOS behaviour is wrong on a desktop OS, from the package's root, each
 * with the file a desktop bundle takes in its place, by OS. The override imports the file it
 * replaces, and that import is left alone.
 */
const OVERRIDES = new Map([
  [
    ['Libraries', 'Utilities', 'Platform.ios.js'].join(path.sep),
    {
      macos: require.resolve('./macos/Platform.macos.js'),
      linux: require.resolve('./macos/Platform.linux.js'),
    },
  ],
  [
    ['Libraries', 'Image', 'resolveAssetSource.js'].join(path.sep),
    {
      macos: require.resolve('./macos/resolveAssetSource.macos.js'),
      linux: require.resolve('./macos/resolveAssetSource.macos.js'),
    },
  ],
]);

const OWN_OVERRIDES = new Set([...OVERRIDES.values()].flatMap((byOs) => Object.values(byOs)));

const EXPO_REQUEST = /^(expo(\/|$)|expo-)/;

/**
 * Expo's JavaScript-only modules that babel-preset-expo writes imports of into the app's own files,
 * which resolve as they do anywhere else. In dev it reads `process.env.EXPO_PUBLIC_*` through
 * `expo/virtual/env`, which an empty module would leave `undefined`.
 */
const PRESET_IMPORTS = new Set(['expo/virtual/env']);

/** A file inside Expo's own packages, whose imports of each other are kept. */
const EXPO_FILE = /[\\/]node_modules[\\/](expo|expo-[^\\/]+|@expo[\\/][^\\/]+)[\\/]/;

/**
 * What `name` resolves to in a desktop bundle where that differs from Metro's answer, or nothing.
 *
 * @param {{ originModulePath?: string }} context
 * @param {string} name
 * @param {string | null} platform
 * @param {ReadonlySet<string>} kept requests Expo's config adds to every bundle, such as the module
 *   a lazy `import()` loads, which resolve as they would anywhere else
 */
function macosRequest(context, name, platform, kept) {
  if (!isDesktop(platform) || !EXPO_REQUEST.test(name)) return undefined;
  const from = context.originModulePath ?? '';
  if (OWN_RUNTIMES.has(from) || kept.has(name) || PRESET_IMPORTS.has(name)) return undefined;
  if (name === 'expo') return { type: 'sourceFile', filePath: RUNTIMES[platform] };
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
  if (!projectRoot || (!OWN_RUNTIMES.has(from ?? '') && !OWN_OVERRIDES.has(from ?? ''))) {
    return context;
  }
  return { ...context, originModulePath: path.join(projectRoot, 'package.json') };
}

/**
 * The override a desktop bundle takes in place of a resolved React Native file, or the resolution
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
  if (!isDesktop(platform) || !file) return resolution;
  for (const [replaced, byOs] of OVERRIDES) {
    const override = byOs[platform];
    const marker = `${path.sep}react-native${path.sep}${replaced}`;
    if (file.endsWith(marker) && context.originModulePath !== override) {
      return { type: 'sourceFile', filePath: override };
    }
  }
  return resolution;
}

/**
 * The transformer's params with the desktop Babel plugin added, for a desktop bundle, or as they
 * were. The plugin is told the OS, which React Native's iOS checks and `Platform.select` answer for.
 *
 * @template {{ options?: { platform?: string | null }, plugins?: unknown[] }} P
 * @param {P} params
 * @returns {P}
 */
function withMacosPlugins(params) {
  const platform = params.options?.platform;
  if (!isDesktop(platform)) return params;
  const plugin = [require('./macos-babel.cjs'), { platform }];
  return { ...params, plugins: [...(params.plugins ?? []), plugin] };
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
 * Throws when the app asks for a desktop OS and Expo would quietly leave it out: `expo.platforms`
 * lists `macos` or `linux`, or the command was given `-p` with one, and
 * `experiments.outOfTreePlatforms` is not set. Without the flag Expo's config drops every platform
 * but iOS, Android and web, so `expo export -p macos` writes nothing for it and says nothing.
 *
 * @param {{ platforms?: string[], experiments?: { outOfTreePlatforms?: boolean } } | undefined} expo
 *   the app's `expo` config
 * @param {readonly string[]} [argv] the command's arguments
 */
function checkOutOfTreePlatforms(expo, argv = process.argv) {
  if (!expo || expo.experiments?.outOfTreePlatforms === true) return;
  const asked = [
    ...(Array.isArray(expo.platforms) ? expo.platforms : []),
    ...requestedPlatforms(argv),
  ];
  const desktop = asked.find((platform) => DESKTOP_PLATFORMS.has(platform));
  if (!desktop) return;
  throw new Error(
    `[angular-native] ${DESKTOP_NAMES[desktop]} needs "experiments": { "outOfTreePlatforms": true } in the "expo" config. ` +
      `Without it Expo leaves ${desktop} out of every bundle and export, and says nothing.\n` +
      'Add this to app.json:\n' +
      '  "expo": { "experiments": { "outOfTreePlatforms": true } }\n' +
      '(merge it into the "expo" object already there). In app.config.js or app.config.ts, ' +
      'return experiments: { outOfTreePlatforms: true } from the config.',
  );
}

/**
 * The app's `expo` config, as the Expo CLI reads it, or nothing where it cannot be read: a project
 * with no Expo config, or a config that throws, which the Expo CLI reports itself.
 *
 * Its `platforms` are Expo's reading of them with the ones app.json declares added, where it declares
 * any: Expo's own reading drops `macos` and `linux` from them when `outOfTreePlatforms` is not set, which is
 * the case to say so for.
 *
 * @param {string | undefined} projectRoot
 */
function expoConfig(projectRoot) {
  if (!projectRoot) return undefined;
  try {
    const from = { paths: [projectRoot] };
    const { getConfig } = require(require.resolve('expo/config', from));
    const { exp, rootConfig } = getConfig(projectRoot, {
      skipSDKVersionRequirement: true,
      skipPlugins: true,
    });
    const declared = (rootConfig?.expo ?? rootConfig)?.platforms;
    if (!Array.isArray(declared)) return exp;
    // The dynamic config's platforms too, which Expo's reading keeps, beside the declared ones.
    // ponytail: a dynamic config that removes a platform app.json declares still has it checked.
    const read = Array.isArray(exp.platforms) ? exp.platforms : [];
    return { ...exp, platforms: [...new Set([...read, ...declared])] };
  } catch {
    return undefined;
  }
}

module.exports = {
  DESKTOP_PLATFORMS,
  macosRequest,
  macosOverride,
  runtimeContext,
  withMacosPlugins,
  checkOutOfTreePlatforms,
  expoConfig,
  requestedPlatforms,
};
