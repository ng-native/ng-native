/**
 * `ngNative()`: the Vite plugin that lets Vitest run Angular Native code in Node, with no DOM.
 *
 * Six things, each of which Vitest would otherwise get wrong on its own:
 *
 * - It compiles. Every decorated `.ts` goes through `@ng-native/metro`'s AOT transform and every
 *   partial-compiled package through the linker (see `compile.mjs`), before Vite strips types.
 * - It inlines. Vitest hands `node_modules` straight to Node by default, which would mean an
 *   `@ng-native/*` package's `.ts` source reaching a runtime that refuses to strip types under
 *   `node_modules`, and `@angular/*` reaching it unlinked. Inlined, both come through the plugin.
 * - It adds a setup file with the globals Angular reads as it is first evaluated, and runs ES
 *   modules without the CommonJS variables Vitest otherwise injects into them.
 * - It stubs assets. With no `require`, an app's `require('./logo.png')` would throw; it becomes
 *   `{ testUri }` instead. And it stands in for the gesture and animation entry points, whose
 *   React Native source Node cannot load (`STAND_INS`).
 * - It imports a `.md` file as Metro does, as `{ attributes, content, tokens }`, unless a plugin
 *   ahead of it already made the file a module.
 * - It resolves as Metro does. A workspace library's copy of a package at the app's version
 *   resolves to the app's copy (`appCopy`), so a test has one `@ng-native/components`, as the
 *   bundle does.
 *
 * The environment is Vitest's default, `node`. There is no DOM to emulate: the renderer talks to
 * a fake Fabric, and jsdom would only give Angular a `document` to misread.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { compileAngular, compileMarkdown, needsAngular, stubAssets } from './compile.mjs';

const SETUP = fileURLToPath(new URL('./setup.mjs', import.meta.url));

/**
 * Entry points a test gets a stand-in for, because what they import is React Native source that
 * Node cannot load: the gestures and reanimated entry points of `@ng-native/components`, the
 * gesture library itself, which an app imports for `Gesture`, and Reanimated and worklets, which
 * an app imports for `withTiming` and `scheduleOnRN`. See each stand-in for what it does and does
 * not do.
 */
const STAND_INS = Object.fromEntries(
  Object.entries({
    '@ng-native/components/gestures': 'gestures',
    'react-native-gesture-handler': 'gesture-handler',
    '@ng-native/components/reanimated': 'reanimated',
    'react-native-reanimated': 'reanimated-library',
    'react-native-worklets': 'worklets-library',
  }).map(([source, name]) => [source, standIn(name)]),
);

/**
 * Where a stand-in is: the source beside this file in the repository, and the compiled file in
 * the published package, which ships `dist` and no `src`.
 *
 * @param {string} name
 * @param {string | URL} [from] the runner's own directory
 */
export function standIn(name, from = import.meta.url) {
  const source = fileURLToPath(new URL(`../src/${name}.ts`, from));
  return existsSync(source) ? source : fileURLToPath(new URL(`../dist/${name}.js`, from));
}

/**
 * ponytail: inlining is by package name, so a third-party Angular library other than these has
 * to be named in `inline` by the app. Linking whatever turns out to be partial-compiled would
 * mean inlining every dependency, which is slower and breaks CommonJS packages.
 */
const INLINE = [
  /\/node_modules\/@angular\//,
  /\/node_modules\/@ng-native\//,
  /\/node_modules\/@ng-icons\//,
];

/**
 * `compilerOptions.customConditions` from the project's `tsconfig.json`, less `react-native`,
 * which would send a test to React Native's Flow source.
 *
 * @param {string} root
 * @returns {string[]}
 */
function tsconfigConditions(root) {
  try {
    const conditions = JSON.parse(readFileSync(path.join(root, 'tsconfig.json'), 'utf8'))
      .compilerOptions?.customConditions;
    return Array.isArray(conditions) ? conditions.filter((c) => c !== 'react-native') : [];
  } catch {
    return [];
  }
}

/** @param {string[]} conditions */
function withConditions(conditions) {
  if (conditions.length === 0) return {};
  return {
    resolve: { conditions: [...conditions, ...defaultClientConditions] },
    ssr: { resolve: { conditions: [...conditions, ...defaultServerConditions] } },
  };
}

/**
 * `injectCjsGlobals: false` again, for Vitest 4, which has no such option and hands every module
 * a `require` regardless. A module that probes for one then requires React Native's Flow source.
 * A `var` of the same name shadows the one Vitest passes in, and is harmless where there is none.
 * On the first line, so every other line keeps its number. ES modules only: a CommonJS file needs
 * the real thing. A `.js` file is one when its package says `"type": "module"`, as every published
 * `@ng-native/*` package does.
 *
 * @param {string} code
 * @param {string} file
 */
function hideRequire(code, file) {
  if (!/\brequire\b/.test(code) || !isModule(file)) return code;
  // A module that makes its own, with `createRequire`, already sees the one it means.
  if (/\b(?:const|let|var|function|class)\s+require\b/.test(code)) return code;
  return `var require = undefined; ${code}`;
}

/** @param {string} dir */
function manifest(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** @type {Map<string, boolean>} */
const moduleDirs = new Map();

/**
 * Whether `.js` files in a directory are ES modules: the `type` of the nearest `package.json`, as
 * Node decides it. A package's dist can hold a `package.json` of its own with only a `type` in it.
 *
 * @param {string} dir
 * @returns {boolean}
 */
function jsIsModule(dir) {
  let found = moduleDirs.get(dir);
  if (found === undefined) {
    const own = manifest(dir);
    const parent = path.dirname(dir);
    found = own ? own.type === 'module' : parent !== dir && jsIsModule(parent);
    moduleDirs.set(dir, found);
  }
  return found;
}

/** @param {string} file */
function isModule(file) {
  if (/\.(ts|mts|mjs)$/.test(file)) return true;
  return file.endsWith('.js') && jsIsModule(path.dirname(file));
}

/**
 * The directory of the `name` package a resolved file is in, or nothing: installed, or a linked
 * workspace package, whose real path has no `node_modules` in it.
 *
 * @param {string} id
 * @param {string} name
 */
function packageRoot(id, name) {
  const file = id.split('?')[0];
  const marker = `/node_modules/${name}/`;
  const at = file.lastIndexOf(marker);
  if (at !== -1) return file.slice(0, at + marker.length - 1);
  if (!path.isAbsolute(file)) return undefined;
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    // A package's dist can hold a package.json of its own with only a `type` in it.
    const found = manifest(dir)?.name;
    if (found) return found === name ? dir : undefined;
  }
  return undefined;
}

/**
 * The app's copy of a package, when a bare import resolved to another copy at the same version:
 * the rule the Metro preset applies to a bundle, so a test loads what the device does.
 *
 * pnpm installs a package once per set of peers it resolves, so a workspace library that lists
 * `@ng-native/components` gets a copy of its own at the app's version when it was installed after
 * the app. Loaded from the library, that is a second component registry. A copy at another
 * version is the library's own choice, and stays.
 *
 * @param {import('vite').Rollup.PluginContext} context
 * @param {string} source
 * @param {string} importer
 * @param {object} options what Vite passed to `resolveId`
 * @param {string} root the app's directory
 */
async function appCopy(context, source, importer, options, root) {
  const resolution = await context.resolve(source, importer, { ...options, skipSelf: true });
  const pkg = /^(?![./\0])(@[^/]+\/[^/]+|[^/]+)/.exec(source)?.[1];
  const own = pkg && resolution && !resolution.external && packageRoot(resolution.id, pkg);
  if (!own) return resolution;
  // The app's copy can fail where the library's resolved: another version that does not export
  // the subpath. The library's copy is then its own choice.
  const app = await context
    .resolve(source, path.join(root, 'package.json'), { ...options, skipSelf: true })
    .catch(() => null);
  const appRoot = app && !app.external && packageRoot(app.id, pkg);
  const version = (/** @type {string} */ dir) => manifest(dir)?.version;
  return appRoot && appRoot !== own && version(appRoot) && version(appRoot) === version(own)
    ? app
    : resolution;
}

/**
 * Whether `source` is still the file as written, or a file Vite only has in memory. A plugin ahead
 * of this one that made the `.md` a module of its own, as the documentation site's does, keeps it.
 *
 * @param {string} source
 * @param {string} file
 */
function asWritten(source, file) {
  try {
    return readFileSync(file, 'utf8') === source;
  } catch {
    return true;
  }
}

/**
 * @param {{ inline?: (string | RegExp)[], libraryStyles?: string[] | false }} [options]
 * @returns {import('vitest/config').Plugin}
 */
export function ngNative(options = {}) {
  let root = process.cwd();
  return {
    name: 'ng-native',
    enforce: 'pre',
    config: (config) => ({
      // The conditions the project's tsconfig resolves packages with, ahead of Vite's own, so a
      // test takes the same entry tsc does: Nx's TypeScript preset exports a library's source
      // only under one.
      ...withConditions(tsconfigConditions(config?.root ?? process.cwd())),
      test: {
        setupFiles: [SETUP],
        // Vitest hands every ES module a CommonJS `require` by default, for compatibility with an
        // older runner. Code here checks for one to tell a device from Node: given one, it
        // requires `react-native`, whose Flow source nothing in a test can parse. Off, a module
        // sees what it sees under Node itself.
        injectCjsGlobals: false,
        server: { deps: { inline: [...INLINE, ...(options.inline ?? [])] } },
      },
    }),
    configResolved(config) {
      root = config.root;
    },
    resolveId(source, importer, resolveOptions) {
      if (Object.hasOwn(STAND_INS, source)) return STAND_INS[source];
      return importer ? appCopy(this, source, importer, resolveOptions, root) : null;
    },
    transform(source, id) {
      const file = id.split('?')[0];
      if (!file.startsWith('\0') && file.endsWith('.md') && id === file) {
        return asWritten(source, file) ? { code: compileMarkdown(source, file), map: null } : null;
      }
      if (file.startsWith('\0') || !/\.m?[jt]s$/.test(file)) return null;
      const code = file.includes('/node_modules/') ? source : stubAssets(source);
      if (!needsAngular(code, file)) {
        const hidden = hideRequire(code, file);
        return hidden === source ? null : { code: hidden, map: null };
      }
      const result = compileAngular(code, file, {
        libraryStyles: options.libraryStyles,
        projectRoot: root,
      });
      for (const dependency of result.dependencies) this.addWatchFile(dependency);
      return { code: hideRequire(result.code, file), map: result.map ?? null };
    },
  };
}
