/**
 * The build side of `@ng-native/web-compat`, for a Metro config and a Vitest config.
 *
 * A library's stylesheet is written for a browser, where a flex container is a row unless it says
 * otherwise. Here a flex container is a column, so the compiler is asked to read the sheets of the
 * packages named in `libraries`, and of the app's own directories named in `sources`, as a browser
 * does. Both are read where a sheet is compiled, in this process and in Metro's workers, which
 * inherit its environment.
 */

const path = require('node:path');

/**
 * Tell the build the npm packages written for a browser. Named, and never every library: one
 * written for native has its styles compiled too, and its flex containers are columns. Answers
 * the names.
 */
function askForBrowser(options) {
  const libraries = options?.libraries;
  const named =
    Array.isArray(libraries) &&
    libraries.length > 0 &&
    libraries.every((name) => typeof name === 'string' && name.trim());
  if (!named) {
    throw new Error(
      '[angular-native] web-compat needs the npm packages written for a browser as `libraries`, ' +
        `such as { libraries: ["@angular/material"] }; got ${JSON.stringify(libraries)}.`,
    );
  }
  process.env['ANGULAR_NATIVE_LIBRARY_BROWSER'] = libraries.join(',');
  return libraries;
}

/**
 * Components copied into an app are written for a browser as a library's are, and are no
 * package to name: Spartan UI's styled layer is generated into the app's own sources. The
 * directories given as `sources` hold such components, and the build is told where they are.
 *
 * A relative path is from the project. Answers the directories, none where none are given.
 */
function askForBrowserSources(options, projectRoot = process.cwd()) {
  const sources = options?.sources ?? [];
  const named =
    Array.isArray(sources) && sources.every((each) => typeof each === 'string' && each.trim());
  if (!named) {
    throw new Error(
      '[angular-native] web-compat reads `sources` as the directories of the app written for a ' +
        `browser, such as { sources: ["./src/app/ui"] }; got ${JSON.stringify(sources)}.`,
    );
  }
  const directories = sources.map((each) => path.resolve(projectRoot, each));
  if (directories.length)
    process.env['ANGULAR_NATIVE_SOURCE_BROWSER'] = directories.join(path.delimiter);
  else delete process.env['ANGULAR_NATIVE_SOURCE_BROWSER'];
  return directories;
}

/**
 * A Metro config whose transformer reads the sheets of `libraries` and `sources` as a browser
 * does. The cache version changes with both: a file transformed before is cached as it was read
 * then, and would be served as that.
 */
function withWebCompat(config, options) {
  const libraries = askForBrowser(options);
  const sources = askForBrowserSources(options, config.projectRoot);
  const named = ['library-browser', [...libraries].sort().join(','), ...sources].join('-');
  const join = (version) => [version, named].filter(Boolean).join('-');
  // The window's listeners, before any module runs: a library adds one as its modules load,
  // before an app is up to ask for them. See `before-modules.js`.
  const polyfills = config.serializer?.getPolyfills;
  // In Metro's own version too, which every transformer's cache key starts from: a transformer
  // of the app's own need not read the one the preset's transformer hashes.
  return {
    ...config,
    cacheVersion: join(config.cacheVersion),
    transformer: { ...config.transformer, cacheVersion: join(config.transformer?.cacheVersion) },
    serializer: {
      ...config.serializer,
      getPolyfills: (options) => [...(polyfills?.(options) ?? []), BEFORE_MODULES],
    },
  };
}

const BEFORE_MODULES = path.join(__dirname, 'before-modules.js');

/** The same for Vitest, as a Vite plugin: `plugins: [ngNative(), webCompat({ libraries })]`. */
function webCompat(options) {
  askForBrowser(options);
  askForBrowserSources(options);
  return { name: 'ng-native-web-compat', enforce: 'pre' };
}

module.exports = { withWebCompat, webCompat };
