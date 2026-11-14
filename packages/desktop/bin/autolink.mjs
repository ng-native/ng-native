/**
 * Autolinking for the desktop build: which native code the host compiles in, found the way Expo's
 * autolinking finds a library's iOS and Android code.
 *
 * - A library opts in through its `expo-module.config.json`: `macos` among its `platforms`, and a
 *   `macos` entry naming the CMake target its desktop code builds and the folder that holds its
 *   CMake fragment (`desktop` unless it says otherwise):
 *
 *       { "platforms": ["apple", "android", "macos"],
 *         "macos": { "cmakeTarget": "haptics_desktop", "cmakeDir": "desktop" } }
 *
 * - The app's own modules are each `modules/<name>/macos/`, beside `ios/` and `android/`, compiled
 *   in with nothing to register. The module's `expo-module.config.json` may name its CMake target.
 * - A package in the plugin options' `deny` list stays out, whatever it ships.
 * - A dependency with native code and none for the desktop is listed, so `run` and `package` can
 *   say its native modules are absent on macOS.
 *
 * Plain Node with no dependencies, so it runs before anything is built.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Packages whose native side is answered another way on macOS, so they are neither linked nor
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
 *   libraries: DesktopLibrary[],
 *   appModules: AppModule[],
 *   withoutDesktop: string[],
 *   problems: string[],
 * }} DesktopLinks
 */

/**
 * The desktop code an app's build compiles in, and the dependencies with native code that have
 * none. Walks the app's `dependencies` and theirs, as Expo's autolinking does, each package once.
 *
 * @param {string} appDir
 * @param {{ deny?: readonly string[], builtIn?: readonly string[] }} [options] `builtIn` are the
 *   libraries the host compiles in itself, which are neither linked nor reported
 * @returns {DesktopLinks}
 */
export function desktopLinks(appDir, { deny = [], builtIn = [] } = {}) {
  /** @type {DesktopLinks} */
  const links = { libraries: [], appModules: appModules(appDir), withoutDesktop: [], problems: [] };
  const seen = new Set();
  /** @param {string} from @param {string[]} names */
  const walk = (from, names) => {
    for (const name of names) {
      if (seen.has(name) || deny.includes(name) || suppliedOtherwise(name)) continue;
      seen.add(name);
      const dir = packageDir(from, name);
      if (dir === null) continue;
      if (!builtIn.includes(name)) classify(links, name, dir);
      walk(dir, dependencyNames(dir));
    }
  };
  walk(appDir, dependencyNames(appDir));
  links.libraries.sort((a, b) => a.name.localeCompare(b.name));
  links.withoutDesktop.sort();
  return links;
}

/**
 * @param {DesktopLinks} links
 * @param {string} name
 * @param {string} dir
 */
function classify(links, name, dir) {
  const config = readJson(path.join(dir, 'expo-module.config.json'));
  const macos = config?.platforms?.includes('macos') ? config.macos : undefined;
  if (macos === undefined) {
    if (hasNativeCode(dir, config)) links.withoutDesktop.push(name);
    return;
  }
  if (typeof macos?.cmakeTarget !== 'string' || macos.cmakeTarget === '') {
    links.problems.push(
      `${name} lists macos in expo-module.config.json without a macos.cmakeTarget, so it is left out.`,
    );
    return;
  }
  const cmakeDir = path.join(dir, typeof macos.cmakeDir === 'string' ? macos.cmakeDir : 'desktop');
  if (!existsSync(path.join(cmakeDir, 'CMakeLists.txt'))) {
    links.problems.push(
      `${name} names ${path.relative(dir, cmakeDir)}/CMakeLists.txt for macos, which it does not have, so it is left out.`,
    );
    return;
  }
  links.libraries.push({ name, dir, cmakeTarget: macos.cmakeTarget, cmakeDir });
}

/**
 * The app's own modules: each `modules/<name>/macos/` folder.
 *
 * @param {string} appDir
 * @returns {AppModule[]}
 */
function appModules(appDir) {
  const root = path.join(appDir, 'modules');
  if (!isDirectory(root)) return [];
  return readdirSync(root)
    .sort()
    .filter((name) => isDirectory(path.join(root, name, 'macos')))
    .map((name) => {
      const config = readJson(path.join(root, name, 'expo-module.config.json'));
      const target = config?.macos?.cmakeTarget;
      return {
        name,
        dir: path.join(root, name, 'macos'),
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
 * A package's directory as Node resolves it from `from`, or null when it is not installed.
 *
 * @param {string} from
 * @param {string} name
 */
function packageDir(from, name) {
  try {
    const require = createRequire(path.join(from, 'package.json'));
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
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
        'macOS. List a package in the deny option of the @ng-native/desktop plugin to keep it out ' +
        'of this check.',
    );
  }
  return lines;
}
