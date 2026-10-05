/**
 * The Metro config for an Angular Native app, so nobody has to remember the parts.
 *
 * ```js
 * const { getDefaultConfig } = require('expo/metro-config');
 * const { withAngularNative } = require('@ng-native/metro/config.cjs');
 *
 * module.exports = withAngularNative(getDefaultConfig(__dirname));
 * ```
 *
 * Every piece here fails quietly when it is missing, which is the reason this exists rather than
 * a page of setup instructions: without the transformer no Angular component compiles, without
 * the extra source extensions an external template is never watched, without
 * `ng-dev-mode` a release bundle runs Angular with every assertion live, and without
 * `animation-globals` Angular's `animate.enter` and `animate.leave` do nothing at all.
 */
const path = require('node:path');
const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync, watch } = require('node:fs');

const SOURCE_EXTS = ['html', 'css', 'scss', 'md'];

const EXPO_WORKER =
  /@expo[\\/]metro-config[\\/]build[\\/]transform-worker[\\/]transform-worker\.js$/;

/**
 * Polyfills, in the order they must run. Each settles a global that `@angular/core` reads while it
 * is being evaluated, which is why none can be a provider or an import.
 */
const POLYFILLS = [
  require.resolve('./polyfills/ng-dev-mode.js'),
  require.resolve('./polyfills/animation-globals.js'),
  require.resolve('./polyfills/finalization-registry.js'),
];

/**
 * `compilerOptions.customConditions` from the project's own `tsconfig.json`, or none. Only that
 * file, not its `extends`: the Nx generator writes the workspace's conditions into it.
 */
function tsconfigConditions(projectRoot) {
  try {
    const text = readFileSync(path.join(projectRoot ?? process.cwd(), 'tsconfig.json'), 'utf8');
    const conditions = JSON.parse(withoutJsonComments(text)).compilerOptions?.customConditions;
    return Array.isArray(conditions) ? conditions : [];
  } catch {
    return [];
  }
}

/**
 * A tsconfig as plain JSON. tsc reads it with comments and trailing commas allowed, and parsed as
 * strict JSON, one of either threw and every condition went with it, silently.
 */
function withoutJsonComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const end = pastStringOrComment(text, i);
    if (end === i) out += text[i];
    else if (text[i] === '"') out += text.slice(i, end);
    else out += ' ';
    if (end !== i) i = end - 1;
  }
  // Comments are gone, so every comma outside a string is structural.
  let json = '';
  for (let i = 0; i < out.length; i++) {
    const end = pastStringOrComment(out, i);
    if (end !== i) {
      json += out.slice(i, end);
      i = end - 1;
    } else if (out[i] !== ',' || !/^\s*[}\]]/.test(out.slice(i + 1))) {
      json += out[i];
    }
  }
  return json;
}

/** Index just past the string or comment starting at `at`, or `at` itself when neither does. */
function pastStringOrComment(text, at) {
  if (text[at] === '"') return stringEnd(text, at);
  if (text.startsWith('//', at)) {
    const end = text.indexOf('\n', at);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith('/*', at)) {
    const end = text.indexOf('*/', at + 2);
    return end === -1 ? text.length : end + 2;
  }
  return at;
}

/** Index just past the JSON string starting at `at`. */
function stringEnd(text, at) {
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

/** `angular-<version>` of the `@angular/core` the app installed, or nothing if it has none. */
function angularVersion(projectRoot) {
  try {
    const manifest = require.resolve('@angular/core/package.json', {
      paths: [projectRoot ?? process.cwd(), __dirname],
    });
    return `angular-${require(manifest).version}`;
  } catch {
    return undefined;
  }
}

/**
 * The packages whose being installed changes what Babel does to every file, with their versions.
 *
 * `babel-preset-expo` adds the worklets plugin, from `react-native-worklets` or else
 * `react-native-reanimated`, only when it can resolve one, and nothing about that decision is in
 * Metro's cache key. So after `npx expo install react-native-reanimated react-native-worklets`
 * every file Metro had already transformed kept its output from before, worklets untransformed,
 * and the app failed at start with `Cannot read property 'code' of undefined` until the cache was
 * cleared by hand. In the key, installing, removing or upgrading one starts the cache afresh.
 */
const BABEL_PLUGIN_PACKAGES = ['react-native-worklets', 'react-native-reanimated'];

function babelPluginVersions(projectRoot) {
  return BABEL_PLUGIN_PACKAGES.map((name) => {
    // Up the app's own node_modules folders, as a require from the project would look, and not
    // through NODE_PATH, which a package manager's script runner may point anywhere.
    for (let dir = path.resolve(projectRoot ?? process.cwd()); ; dir = path.dirname(dir)) {
      try {
        const manifest = path.join(dir, 'node_modules', name, 'package.json');
        return `${name}-${JSON.parse(readFileSync(manifest, 'utf8')).version}`;
      } catch {
        if (path.dirname(dir) === dir) return undefined;
      }
    }
  });
}

const SINGLETON = /^(@angular\/core|@ng-native\/[^/]+)(\/|$)/;

/**
 * The name and root of the `@angular/core` or `@ng-native/*` package a resolved file is in:
 * installed, or a linked workspace package, whose real path has no `node_modules` in it, so Metro
 * names its package.
 */
function singletonPackage(resolution, request, context) {
  const file = /** @type {{ filePath?: string }} */ (resolution)?.filePath;
  const match = file?.match(
    /^(.*[\\/]node_modules[\\/](@angular[\\/]core|@ng-native[\\/][^\\/]+))[\\/]/,
  );
  if (match) return { name: match[2].replace('\\', '/'), root: match[1] };
  if (!file || !SINGLETON.test(request)) return undefined;
  const found = context.getPackageForModule?.(file);
  const name = found?.packageJson?.name;
  return name && SINGLETON.test(name) ? { name, root: found.rootPath } : undefined;
}

/**
 * Warns, once, when `@angular/core` resolves from a second package root. Components compiled
 * against one copy then ask the other's injector, and the device shows NG0203 at mount with no
 * sign of the cause; a Metro cache kept from before an Angular upgrade is the usual one.
 *
 * The same for each `@ng-native/*` package, which a workspace library can bring at a version of
 * its own: a second `@ng-native/components` is a second component registry.
 *
 * @param {unknown} resolution what Metro resolved a request to
 * @param {string} request the import resolved
 * @param {object} context Metro's resolution context
 */
const singletonRoots = new Map();
function noteSecondCopy(resolution, request, context) {
  const { name, root } = singletonPackage(resolution, request, context) ?? {};
  if (!name || !root) return;
  const roots = singletonRoots.get(name) ?? new Set();
  singletonRoots.set(name, roots);
  if (roots.has(root)) return;
  roots.add(root);
  if (roots.size !== 2) return;
  const copies = `Two copies of ${name} are in this bundle:\n  ${[...roots].join('\n  ')}\n`;
  console.warn(
    name.startsWith('@angular')
      ? `[angular-native] ${copies}` +
          'Components compiled against one fail against the other (NG0203 at mount). If Angular was ' +
          'just upgraded, start Metro again with --clear; otherwise make every package resolve one copy.'
      : `[angular-native] ${copies}` +
          'Each keeps its own state, so the app and a library see different ones. Give every ' +
          'package that lists it the version the app lists.',
  );
}

/**
 * What the Angular CLI does for a production build: `ngDevMode` as a constant `false`, so the
 * minifier drops every dev-mode branch - the assertions, the error strings, `setClassMetadata` -
 * rather than keeping them behind a flag the release polyfill already turns off. Terser only,
 * since its option is the one that says it; a dev bundle is not minified and keeps them all.
 */
function foldDevMode(config) {
  if ((config.transformer.minifierPath ?? 'metro-minify-terser') !== 'metro-minify-terser') return;
  const minifier = config.transformer.minifierConfig ?? {};
  config.transformer.minifierConfig = {
    ...minifier,
    compress: {
      ...minifier.compress,
      global_defs: { ...minifier.compress?.global_defs, ngDevMode: false },
    },
  };
}

/**
 * The directory of the `name` package a resolved file is in, or nothing: installed, or a linked
 * workspace package, whose real path has no `node_modules` in it.
 */
function packageRoot(context, file, name) {
  const marker = `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}${path.sep}`;
  const at = file?.lastIndexOf(marker) ?? -1;
  if (at !== -1) return file.slice(0, at + marker.length - 1);
  const found = file && context.getPackageForModule?.(file);
  return found?.packageJson?.name === name ? found.rootPath : undefined;
}

/**
 * The app's copy of a package, when a bare import resolved to another copy at the same version.
 *
 * pnpm installs a package once per set of peers it resolves, so a workspace library that lists
 * `@ng-native/components` but not the app's `@babel/core` gets its own react-native, and its own
 * components beside it, both at the app's versions. Bundled from the library, those are a second
 * component registry and a second React Native. A copy at another version is the library's own
 * choice, and stays.
 */
function appCopy(resolve, context, name, platform, resolution, projectRoot) {
  const pkg = /^(?![./])(@[^/]+\/[^/]+|[^/]+)/.exec(name)?.[1];
  const own = pkg && packageRoot(context, resolution?.filePath, pkg);
  if (!own || !projectRoot) return resolution;
  try {
    const fromApp = { ...context, originModulePath: path.join(projectRoot, 'package.json') };
    const app = resolve(fromApp, name, platform);
    const root = packageRoot(context, app?.filePath, pkg);
    const version = (dir) => context.getPackage?.(path.join(dir, 'package.json'))?.version;
    return root && root !== own && version(root) && version(root) === version(own)
      ? app
      : resolution;
  } catch {
    return resolution;
  }
}

/** Marks a resolver this preset already wrapped, so applying the preset twice wraps it once. */
const WRAPPED = Symbol.for('ng-native.resolveRequest');

/**
 * A relative `./lib/ui.js` that names `./lib/ui.ts`, resolved as TypeScript resolves it.
 *
 * TypeScript's `NodeNext` resolution wants the extension the file will have once compiled, so a
 * library in Nx's TypeScript preset writes `export * from './lib/ui.js'` beside a `ui.ts`. tsc and
 * Vitest follow it; Metro looks for a `.js` that does not exist. Only when that fails, and only for
 * a relative path, it tries again without the extension, which Metro completes from `sourceExts`.
 *
 * Wraps whatever resolver is there already, `withNxMetro`'s included, rather than replacing it.
 *
 * `@babel/runtime` resolves from the app's project first. babel-preset-expo writes imports of it
 * into files whose packages never declared it, for the version Expo read from the project. Under
 * pnpm those files find `node_modules/.pnpm/node_modules` before the project's copy, and an install
 * from before the app's pin can leave Babel 8's runtime there, which has no `regenerator`.
 *
 * @param {Function | undefined} next
 * @param {string | undefined} projectRoot
 */
function withTypeScriptJsImports(next, projectRoot) {
  if (next?.[WRAPPED]) return next;
  const resolveRequest = (context, name, platform) => {
    const resolve = next ?? context.resolveRequest;
    if (projectRoot && /^@babel\/runtime(\/|$)/.test(name)) {
      try {
        const fromProject = {
          ...context,
          originModulePath: path.join(projectRoot, 'package.json'),
        };
        return resolve(fromProject, name, platform);
      } catch {
        // No copy the project reaches: the import's own lookup, below.
      }
    }
    try {
      const resolution = appCopy(
        resolve,
        context,
        name,
        platform,
        resolve(context, name, platform),
        projectRoot,
      );
      noteSecondCopy(resolution, name, context);
      return resolution;
    } catch (error) {
      if (!/^\.{1,2}\/.*\.[mc]?js$/.test(name)) throw error;
      try {
        return resolve(context, name.replace(/\.[mc]?js$/, ''), platform);
      } catch {
        throw error;
      }
    }
  };
  resolveRequest[WRAPPED] = true;
  return resolveRequest;
}

/**
 * The request for a lazy chunk from outside Metro's server root, with its path from the server
 * root put back, or nothing for any other request.
 *
 * Expo addresses a chunk by its path from the server root, so a library beside the app is
 * `/../../libs/settings/src/index.bundle`. The URL drops the `..`, and Metro looks for
 * `libs/settings/src/index` inside the app. The server root is the app's own directory wherever
 * the app is not a package-manager workspace, as in an integrated Nx workspace. So a chunk that
 * names no file under the server root is looked for in each directory above it, nearest first,
 * and the path to the one that has it goes in `bundleEntry`, which Metro reads in place of the
 * URL's path.
 *
 * A chunk's own lazy imports copy its query, so a `bundleEntry` that climbs out of the server
 * root came from the chunk that imported this one, and is worked out again.
 *
 * The search climbs to the root of the disk, but a file counts only inside the server root or a
 * watch folder: Metro bundles nothing else, and the dev server answers anyone on the network, who
 * would otherwise learn which files exist anywhere on the machine.
 *
 * @param {string} url
 * @param {{ serverRoot: string, sourceExts: readonly string[], watchFolders: readonly string[] }} roots
 */
function chunkOutsideServerRoot(url, { serverRoot, sourceExts, watchFolders }) {
  const request = new URL(url, 'http://localhost');
  const [, file, kind] = /^\/(.+)\.(bundle|map)$/.exec(request.pathname) ?? [];
  if (!file || request.searchParams.get('modulesOnly') !== 'true') return undefined;
  const inherited = request.searchParams.get('bundleEntry')?.startsWith('../');
  if (inherited) request.searchParams.delete('bundleEntry');
  const written = () =>
    url.startsWith('/') ? request.pathname + request.search + request.hash : request.href;

  const name = decodedName(file);
  if (name === undefined) return inherited ? written() : undefined;
  const watched = [serverRoot, ...watchFolders].map((folder) => path.resolve(folder));
  const has = (dir) =>
    watched.some((folder) => isInside(path.join(dir, name), folder)) &&
    sourceExts.some((ext) => existsSync(path.join(dir, `${name}.${ext}`)));
  if (!has(serverRoot)) {
    for (let dir = path.dirname(serverRoot); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      if (!has(dir)) continue;
      const entry = path.relative(serverRoot, path.join(dir, name)).split(path.sep).join('/');
      request.searchParams.set('bundleEntry', `${entry}.${kind}`);
      return written();
    }
  }
  return inherited ? written() : undefined;
}

/** Whether `file` is `folder` or below it. */
function isInside(file, folder) {
  const relative = path.relative(folder, file);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

/**
 * A chunk's name from its URL, decoded, or nothing for one that is not a path below a directory.
 *
 * The URL normalizes away a `..` it can see, not one it percent-encoded, so decoding can bring one
 * back, and the dev server answers anyone on the network. A name with a `..` segment, a root of
 * its own (`/`, `C:`) or a backslash would look for files outside the directory being searched,
 * and is left to Metro, as is one that does not decode.
 *
 * @param {string} file
 */
function decodedName(file) {
  let name;
  try {
    name = decodeURIComponent(file);
  } catch {
    return undefined;
  }
  const outside =
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-z]:/i.test(name) ||
    name.split('/').includes('..');
  return outside ? undefined : name;
}

/** Where an app parks its history: see `withParkedRoute`. */
const PARKED_ROUTE = '/__ng-native/route';
/** How long a parked history waits for its app. A reload is back in a few seconds. */
const PARKED_FOR = 60_000;
/** More than any history is; the dev server answers anyone on the network. */
const PARKED_BYTES = 64 * 1024;

/**
 * Holds the history an app leaves when it reloads itself, for the app that comes back.
 *
 * A full reload takes the JavaScript runtime with it, and the router's history is in it, so the
 * app came back on its first route. Nothing on the device outlives the reload without a native
 * module an app may not have, and the dev server does: the app posts its history here before it
 * reloads and asks for it when it starts. See `route-parking.ts` in `@ng-native/router`.
 *
 * A history is handed back once, and only within a minute, so an app launched afresh starts where
 * it always does. One per `app` in the query, which is the platform: an iPhone and an Android
 * phone on one server each get their own back.
 */
function withParkedRoute(config) {
  const parked = new Map();
  const enhance = config.server?.enhanceMiddleware;
  const enhanceMiddleware = (middleware, server) => {
    const metro = enhance ? enhance(middleware, server) : middleware;
    return (req, res, next) => {
      if (!req.url?.startsWith(PARKED_ROUTE)) return metro(req, res, next);
      const app = new URL(req.url, 'http://localhost').searchParams.get('app') ?? '';
      const answer = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      };
      if (req.method !== 'POST') {
        const left = parked.get(app);
        parked.delete(app);
        return answer(200, left && Date.now() - left.at < PARKED_FOR ? left.urls : 'null');
      }
      let body = '';
      req.on('data', (chunk) => {
        if (body.length <= PARKED_BYTES) body += chunk;
      });
      req.on('end', () => {
        let urls;
        try {
          urls = body.length <= PARKED_BYTES ? JSON.parse(body) : null;
        } catch {
          // Not JSON: refused below.
        }
        if (!Array.isArray(urls) || !urls.every((page) => typeof page?.url === 'string')) {
          return answer(400, 'null');
        }
        parked.set(app, { urls: JSON.stringify(urls), at: Date.now() });
        answer(204, '');
      });
    };
  };
  config.server = { ...config.server, enhanceMiddleware };
}

/**
 * Wraps the server's `rewriteRequestUrl`, Expo's included, so a lazy chunk from a library outside
 * the server root is served: see `chunkOutsideServerRoot`.
 */
function withChunksOutsideServerRoot(config) {
  const next = config.server?.rewriteRequestUrl;
  if (next?.[WRAPPED]) return;
  const rewriteRequestUrl = (url) => {
    const rewritten = next ? next(url) : url;
    const roots = {
      serverRoot: path.resolve(
        config.server?.unstable_serverRoot ?? config.projectRoot ?? process.cwd(),
      ),
      sourceExts: config.resolver.sourceExts,
      watchFolders: [config.projectRoot ?? process.cwd(), ...(config.watchFolders ?? [])],
    };
    return chunkOutsideServerRoot(rewritten, roots) ?? rewritten;
  };
  rewriteRequestUrl[WRAPPED] = true;
  config.server = { ...config.server, rewriteRequestUrl };
}

/**
 * @param {object} config a Metro config, usually from `getDefaultConfig(__dirname)`
 * @param {{ workspaceRoot?: string, projectRoot?: string, libraryStyles?: string[] | false }} [options]
 *   `workspaceRoot` for a monorepo, where the framework packages live outside the app's own
 *   `node_modules` and Metro has to be told to watch them. An app installing from npm needs
 *   neither and should pass nothing. Every library's component CSS is compiled into native
 *   sheets, as the app's own is; `libraryStyles` narrows that to the npm packages it names, and
 *   `false` to none. A library left out draws unstyled. An `@ng-native/*` package's is compiled
 *   whatever the option says.
 */
/**
 * A hash of the compiler's own sources.
 *
 * Metro caches a transform result against the file's content and its own version, and knows
 * nothing about the transformer it called. So editing this project's compiler is not enough even
 * after a restart: every file whose own text has not changed keeps the output the old compiler
 * gave it, and only the files you also happen to edit pick the change up. A half-applied compiler
 * is harder to read than one that did not apply at all - the symptom is some components behaving
 * one way and the rest another, with nothing in the source to explain it.
 *
 * `cacheVersion` is Metro's documented lever for this, and this is what goes in it.
 *
 * `.cjs` only. A README beside the compiler is not the compiler, and a cache that clears on a typo
 * fix is a cache people turn off.
 */
function compilerFingerprint(dir) {
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.cjs')) {
        files.push(full);
      }
    }
  };
  walk(dir);

  const hash = createHash('sha1');
  for (const file of files) {
    // The name as well as the content: a rule moved between two files is a different compiler.
    hash.update(path.relative(dir, file));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Watch the compiler's own sources and say when they change.
 *
 * Deliberately a message rather than an attempt to fix it. Reloading a transformer inside a
 * running Metro means replacing modules in a worker pool that is mid-transform, and getting that
 * subtly wrong would put us back where we started - a dev server whose output does not match its
 * input - with more machinery in the way of noticing.
 */
function watchCompiler(dir, fingerprint) {
  let told = false;
  const check = () => {
    if (told || compilerFingerprint(dir) === fingerprint) return;
    told = true;
    console.warn(
      '[angular-native] the compiler changed on disk. Metro loaded it when it started, so this ' +
        'edit reaches nothing until the dev server is restarted - the app will go on running the ' +
        'output of the version from before it.',
    );
  };
  const watcher = watch(dir, { recursive: true, persistent: false }, check);
  watcher.unref?.();
  return watcher;
}

/**
 * The `libraryStyles` list as given, checked: nothing when the option is not given, which is
 * every library, and an empty list for `false`, which is none.
 *
 * It is a list of package names and nothing else, because a wrong shape here would reach the
 * transformer as a list that matches no file, and every library would draw unstyled with no word
 * about why.
 */
function libraryStylesOf(options) {
  const { libraryStyles } = options;
  if (libraryStyles === undefined) return undefined;
  if (libraryStyles === false) return [];
  const names = Array.isArray(libraryStyles)
    ? libraryStyles.every((name) => typeof name === 'string' && name.trim())
    : false;
  if (!names) {
    throw new Error(
      '[angular-native] libraryStyles must be a list of npm package names, or false, such as ' +
        `["@acme/ui"]; got ${JSON.stringify(libraryStyles)}.`,
    );
  }
  for (const name of libraryStyles) {
    const wrong = wrongPackageName(name);
    if (wrong) throw new Error(`[angular-native] libraryStyles: '${name}' ${wrong}`);
  }
  return [...new Set(libraryStyles)];
}

/**
 * Why a name is no npm package's, or null when it could be one: a list entry matches a file by
 * its package's name alone, so a name that is close but not it would match nothing in silence.
 */
function wrongPackageName(name) {
  if (/\s/.test(name)) return 'has white space in it, which no package name has.';
  if (/^[./]/.test(name)) {
    return "is a path. Name the package, as its package.json's name says it.";
  }
  if (/^@[^/]*\/?$/.test(name))
    return `is a scope. Name a package in it, as '${name.replace(/\/$/, '')}/ui'.`;
  const [, scope, rest] = /^(@[^/]+\/)?(.*)$/.exec(name);
  if (rest.includes('/')) {
    const root = (scope ?? '') + rest.split('/')[0];
    return (
      `is an entry point of '${root}', and the CSS is compiled a package at a time: ` +
      `name '${root}'.`
    );
  }
  if (name !== name.toLowerCase()) {
    return `has capital letters, and npm takes only lowercase names for a new package: '${name.toLowerCase()}'?`;
  }
  if (!/^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/.test(name)) {
    return 'has a character an npm package name cannot.';
  }
  return null;
}

/**
 * A library's component CSS, compiled on the way through the linker: every library's, with
 * nothing to record, unless the app narrowed them. A list travels to the transformer through the
 * worker `withAngularNative` installs, which is the only path there is (see
 * `transform-worker.cjs`), so in front of any other worker the option would quietly do nothing.
 *
 * The list goes into `cacheVersion` as well, as the compiler's fingerprint does. A transform is
 * cached against the file and that version, and the transformer config is in no key of Metro's
 * here - Expo's worker has no `getCacheKey` - so without this, changing the list would leave every
 * file cached as it was transformed before, until a `--clear`.
 */
function recordLibraryStyles(config, options) {
  const libraryStyles = libraryStylesOf(options);
  if (!libraryStyles) {
    delete process.env['ANGULAR_NATIVE_LIBRARY_STYLES'];
    return;
  }
  if (config.transformerPath !== require.resolve('./transform-worker.cjs')) {
    throw new Error(
      "[angular-native] libraryStyles needs this preset in front of Expo's transform worker, " +
        `and the config has transformerPath "${config.transformerPath}" instead. Start from ` +
        "getDefaultConfig(__dirname) from 'expo/metro-config', or leave transformerPath to it.",
    );
  }
  config.transformer.angularNativeLibraryStyles = libraryStyles;
  // For the transformer to notice a worker that does not carry the list: see `transformer.cjs`.
  // Metro's workers inherit the environment of the process that loaded this config.
  process.env['ANGULAR_NATIVE_LIBRARY_STYLES'] = libraryStyles.join(',');
  config.transformer.cacheVersion = [
    config.transformer.cacheVersion,
    `library-styles-${[...libraryStyles].sort().join(',') || 'none'}`,
  ]
    .filter(Boolean)
    .join('-');
}

function withAngularNative(config, options = {}) {
  const { workspaceRoot, projectRoot = config.projectRoot } = options;

  config.transformer.babelTransformerPath = require.resolve('./transformer.cjs');

  // Expo's worker empties every native stylesheet before the transformer above can see it, which
  // leaves an edited `styleUrl` nothing to carry its update in. Only Expo's is wrapped: a worker
  // someone configured themselves is theirs, and an edited stylesheet does not hot-swap there.
  if (EXPO_WORKER.test(config.transformerPath ?? '')) {
    config.transformer.angularNativeUpstreamTransformer = path.relative(
      projectRoot ?? process.cwd(),
      config.transformerPath,
    );
    config.transformerPath = require.resolve('./transform-worker.cjs');
  }

  recordLibraryStyles(config, options);

  // So a change to the compiler invalidates every cached transform rather than only the files
  // that happen to be edited alongside it.
  const fingerprint = compilerFingerprint(__dirname);
  // And a change of Angular: a transform cached against the old one can pull in the old copy,
  // and two copies in one bundle fail at mount with NG0203, nowhere near the upgrade that did it.
  config.transformer.cacheVersion = [
    config.transformer.cacheVersion,
    fingerprint,
    angularVersion(config.projectRoot),
    ...babelPluginVersions(config.projectRoot),
  ]
    .filter(Boolean)
    .join('-');

  /*
   * And say so when it changes while the server is up, because the cache is only half of it.
   *
   * Metro loads this config and the transformer once, into this process and its worker pool. A
   * fingerprint computed at startup cannot notice its own sources changing afterwards, and the
   * workers go on running the compiler they were given - so an edit here reaches nothing at all
   * until a restart, silently. That is a full afternoon's worth of screenshots of the wrong build.
   *
   * Only in a dev server: `cacheVersion` alone is the whole story for a production bundle, which
   * is built once by a process that started after the edit.
   */
  if (config.resetCache !== undefined || process.env['NODE_ENV'] !== 'production') {
    watchCompiler(__dirname, fingerprint);
  }

  // External templates and stylesheets are in the graph so Metro watches them. In a release build
  // the transformer emits them as empty modules; in dev each one carries the hot update for the
  // components that use it, because Metro re-transforms only the file that changed. A `.md` file
  // is a module of its own: see `markdown-module.cjs`.
  const exts = config.resolver.sourceExts;
  config.resolver.sourceExts = [...exts, ...SOURCE_EXTS.filter((ext) => !exts.includes(ext))];
  // Expo lists `html` as an asset, for its DOM components, and Metro checks assets first. Left
  // there, a template is bundled as an image-like asset record our transformer never sees, and
  // an edit to it re-runs the component's module to no effect.
  if (config.resolver.assetExts) {
    config.resolver.assetExts = config.resolver.assetExts.filter(
      (ext) => !SOURCE_EXTS.includes(ext),
    );
  }

  config.resolver.resolveRequest = withTypeScriptJsImports(
    config.resolver.resolveRequest,
    projectRoot,
  );

  withChunksOutsideServerRoot(config);
  withParkedRoute(config);

  foldDevMode(config);

  // The conditions the app's tsconfig resolves packages with, so Metro takes the same entry tsc
  // does. Nx's TypeScript preset exports a library's source only under one; without it Metro took
  // the `dist` entry, which is never built. `react-native` is Metro's own, per platform, already.
  const conditions = tsconfigConditions(config.projectRoot).filter((c) => c !== 'react-native');
  const named = config.resolver.unstable_conditionNames ?? [];
  config.resolver.unstable_conditionNames = [
    ...named,
    ...conditions.filter((c) => !named.includes(c)),
  ];

  const base = config.serializer.getPolyfills;
  config.serializer.getPolyfills = (metroOptions) => {
    const existing = base(metroOptions);
    return [...existing, ...POLYFILLS.filter((file) => !existing.includes(file))];
  };

  if (workspaceRoot) {
    config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
    config.resolver.nodeModulesPaths = [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ];
  }

  return config;
}

// An app reaches this file through `withAngularNative` alone. The other three are exported for the
// integration tests, which pin what each does on its own.
module.exports = { withAngularNative, compilerFingerprint, chunkOutsideServerRoot, watchCompiler };
