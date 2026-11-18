/**
 * Autolinking for the desktop build: which native code the host compiles in, found the way Expo's
 * autolinking finds a library's iOS and Android code.
 *
 * Everything below is per desktop OS (`DESKTOP_OSES`), named by the key it is configured under:
 * `macos` or `linux`.
 *
 * - A library opts in through its `expo-module.config.json`: the OS among its `platforms`, and an
 *   entry of that name naming the CMake target its desktop code builds and the folder that holds
 *   its CMake fragment (`desktop` unless it says otherwise). A library that builds for both lists
 *   both, and its fragment can be one folder for both or one for each:
 *
 *       { "platforms": ["apple", "android", "macos", "linux"],
 *         "macos": { "cmakeTarget": "haptics_desktop", "cmakeDir": "desktop" },
 *         "linux": { "cmakeTarget": "haptics_desktop", "cmakeDir": "desktop" } }
 *
 * - The app's own modules are each `modules/<name>/<os>/`, beside `ios/` and `android/`, compiled
 *   in with nothing to register. The module's `expo-module.config.json` may name its CMake target
 *   under the OS's key.
 * - A package in the plugin options' `deny` list stays out, whatever it ships; the packages it
 *   depends on are still walked.
 * - A dependency with native code and none for the OS is listed, so `run` and `package` can
 *   say its native modules are absent there.
 *
 * Plain Node with no dependencies, so it runs before anything is built.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The desktop OSes autolinking links native code for: the desktop members of `OS_NAMES` in
 * `@ng-native/device`, which a test keeps equal. `macos` is the default wherever an OS is optional.
 *
 * @typedef {'macos' | 'linux'} DesktopOs
 */
export const DESKTOP_OSES = /** @type {const} */ (['macos', 'linux']);

/** How each OS is written in a message. */
const OS_LABELS = { macos: 'macOS', linux: 'Linux' };

/**
 * Packages whose native side is answered another way on a desktop OS, so they are neither linked nor
 * reported: React Native and React themselves, Expo (`expo` and `expo-*` resolve to empty modules
 * there, and the host's own modules answer the services that use them) and this framework.
 *
 * @param {string} name
 */
function suppliedOtherwise(name) {
  return (
    name === 'react' ||
    name === 'react-native' ||
    name === 'expo' ||
    name.startsWith('expo-') ||
    name.startsWith('@expo/') ||
    name.startsWith('@ng-native/') ||
    name.startsWith('@react-native/')
  );
}

/**
 * @typedef {{ name: string, dir: string, cmakeTarget: string, cmakeDir: string }} DesktopLibrary
 * @typedef {{ name: string, dir: string, cmakeTarget: string | null }} AppModule
 * @typedef {{
 *   os: DesktopOs,
 *   libraries: DesktopLibrary[],
 *   appModules: AppModule[],
 *   hostLibraries: { name: string, dir: string }[],
 *   withoutDesktop: string[],
 *   problems: string[],
 * }} DesktopLinks
 */

/**
 * The desktop code an app's build compiles in for `os`, and the dependencies with native code that
 * have none. Walks the app's `dependencies` and theirs, as Expo's autolinking does, each package once.
 *
 * @param {string} appDir
 * @param {{ os?: DesktopOs, deny?: readonly string[], builtIn?: readonly string[] }} [options]
 *   `os`: the OS the build is for (macos unless said); `builtIn` are the
 *   libraries the host compiles in itself, which are neither linked nor reported: `hostLibraries`
 *   says where each one the walk finds is installed, under a dependency's node_modules too
 * @returns {DesktopLinks}
 */
export function desktopLinks(appDir, { os = 'macos', deny = [], builtIn = [] } = {}) {
  assertDesktopOs(os);
  /** @type {DesktopLinks} */
  const links = {
    os,
    libraries: [],
    appModules: appModules(appDir, os),
    hostLibraries: [],
    withoutDesktop: [],
    problems: [],
  };
  const seen = new Set();
  // Breadth first, so a package nearer the app wins: the app's own version of a library is the
  // one taken, not an older copy nested under a dependency listed before it.
  const queue = [appDir];
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    for (const name of dependencyNames(from)) {
      if (seen.has(name) || suppliedOtherwise(name)) continue;
      seen.add(name);
      const dir = packageDir(from, name);
      if (dir === null) continue;
      // A denied package stays out of the build and the warning, but what it depends on does not.
      if (deny.includes(name)) {
        // Neither linked nor reported.
      } else if (builtIn.includes(name)) links.hostLibraries.push({ name, dir });
      else classify(links, name, dir);
      queue.push(dir);
    }
  }
  links.libraries.sort((a, b) => a.name.localeCompare(b.name));
  links.hostLibraries.sort((a, b) => builtIn.indexOf(a.name) - builtIn.indexOf(b.name));
  links.withoutDesktop.sort();
  return links;
}

/** @param {string} os */
function assertDesktopOs(os) {
  if (!DESKTOP_OSES.some((desktop) => desktop === os)) {
    throw new Error(`Autolinking is for ${DESKTOP_OSES.join(' and ')}, not '${os}'.`);
  }
}

/**
 * @param {DesktopLinks} links
 * @param {string} name
 * @param {string} dir
 */
function classify(links, name, dir) {
  const { os } = links;
  const config = readJson(path.join(dir, 'expo-module.config.json'));
  const entry = config?.platforms?.includes(os) ? config[os] : undefined;
  if (entry === undefined) {
    if (hasNativeCode(dir, config)) links.withoutDesktop.push(name);
    return;
  }
  if (typeof entry?.cmakeTarget !== 'string' || entry.cmakeTarget === '') {
    links.problems.push(
      `${name} lists ${os} in expo-module.config.json without a ${os}.cmakeTarget, so it is left out.`,
    );
    return;
  }
  const cmakeDir = path.join(dir, typeof entry.cmakeDir === 'string' ? entry.cmakeDir : 'desktop');
  if (!existsSync(path.join(cmakeDir, 'CMakeLists.txt'))) {
    links.problems.push(
      `${name} names ${path.relative(dir, cmakeDir)}/CMakeLists.txt for ${os}, which it does not have, so it is left out.`,
    );
    return;
  }
  links.libraries.push({ name, dir, cmakeTarget: entry.cmakeTarget, cmakeDir });
}

/**
 * The app's own modules: each `modules/<name>/<os>/` folder.
 *
 * @param {string} appDir
 * @param {DesktopOs} os
 * @returns {AppModule[]}
 */
function appModules(appDir, os) {
  const root = path.join(appDir, 'modules');
  if (!isDirectory(root)) return [];
  return readdirSync(root)
    .sort()
    .filter((name) => isDirectory(path.join(root, name, os)))
    .map((name) => {
      const config = readJson(path.join(root, name, 'expo-module.config.json'));
      const target = config?.[os]?.cmakeTarget;
      return {
        name,
        dir: path.join(root, name, os),
        cmakeTarget: typeof target === 'string' && target !== '' ? target : null,
      };
    });
}

/**
 * Whether a package ships native code for a phone: an Expo module for iOS or Android, a React
 * Native codegen spec, a podspec, or an `ios` or `android` folder.
 *
 * @param {string} dir
 * @param {{ platforms?: string[] } | null} config its expo-module.config.json
 */
function hasNativeCode(dir, config) {
  if (config?.platforms?.some((platform) => ['apple', 'ios', 'android'].includes(platform))) {
    return true;
  }
  if (readJson(path.join(dir, 'package.json'))?.codegenConfig) return true;
  if (isDirectory(path.join(dir, 'ios')) || isDirectory(path.join(dir, 'android'))) return true;
  return readdirSync(dir).some((file) => file.endsWith('.podspec'));
}

/** @param {string} dir */
function dependencyNames(dir) {
  return Object.keys(readJson(path.join(dir, 'package.json'))?.dependencies ?? {});
}

/**
 * A package's directory as Node finds it from `from`, or null when it is not installed: the first
 * `node_modules/<name>` up the tree, with symlinks resolved. Looked up directly rather than through
 * `require.resolve('<name>/package.json')`, which throws for a package whose `exports` leave
 * package.json out.
 *
 * @param {string} from
 * @param {string} name
 */
function packageDir(from, name) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (path.dirname(dir) === dir) return null;
  }
}

/** @param {string} file @returns {any} */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} dir */
function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * What `run` and `package` print about the links: a line for each library left out, and one
 * naming the dependencies with no desktop code. Empty when there is nothing to say.
 *
 * @param {DesktopLinks} links
 * @returns {string[]}
 */
export function linkWarnings(links) {
  const lines = [...links.problems];
  if (links.withoutDesktop.length > 0) {
    lines.push(
      `No desktop code in ${links.withoutDesktop.join(', ')}: their native modules are absent on ` +
        `${OS_LABELS[links.os]}. List a package in the deny option of the @ng-native/desktop plugin to keep it out ` +
        'of this check.',
    );
  }
  return lines;
}
