/**
 * Metro's transform worker, with one file type taken back from Expo's.
 *
 * Expo's worker claims every stylesheet before any babel transformer sees it, and on native hands
 * back an empty module. That is right for a release build, where a component's CSS is compiled
 * into the component's own module. It is wrong for a dev server: an edited `styleUrl` has to carry
 * its component's recompiled sheet to the device, which only our transformer knows how to build,
 * so in dev a native stylesheet goes the way a source file does instead.
 *
 * Everything else, including every web stylesheet and every CSS module, is Expo's as before.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  isAngularDomComponent,
  domComponentEntry,
  withExportedUrls,
} = require('./dom-component.cjs');
const { withResources } = require('./resource-cache.cjs');

const IS_STYLESHEET = /\.(s?css|sass)$/;
const IS_CSS_MODULE = /\.module\.(s?css|sass)$/;

/**
 * The worker `withAngularNative` found configured. Stored relative to the project, because the
 * transformer config is part of Metro's cache key and an absolute path would tie a cache to one
 * checkout.
 */
const upstreamPath = (config, projectRoot) =>
  path.resolve(projectRoot, config.angularNativeUpstreamTransformer);

/** The worker Expo's own hands a source file to, which is the one that runs the babel transformer. */
const innerWorker = (expo) => require(path.join(path.dirname(expo), 'metro-transform-worker'));

/**
 * The entry for a DOM component's page, or null for anything else.
 *
 * Expo generates `expo/dom/entry.js` for each DOM component's page, naming the component in the
 * `dom` transform option, and mounts its default export with React. A DOM component mounts itself,
 * so its entry only loads it; an Expo DOM component is left to Expo.
 */
function domComponentPage(filename, options) {
  const dom = options.customTransformOptions?.dom;
  if (typeof dom !== 'string' || !/expo[\\/]dom[\\/]entry\.js$/.test(filename)) return null;
  const relative = decodeURI(dom);
  const target = path.resolve(path.dirname(filename), relative);
  let src;
  try {
    src = readFileSync(target, 'utf8');
  } catch {
    return null;
  }
  return isAngularDomComponent(src) ? Buffer.from(domComponentEntry(relative)) : null;
}

/**
 * The preset's `libraryStyles`, carried to the babel transformer in the one place Metro lets it
 * through: `customTransformOptions`.
 *
 * The babel transformer is handed a bundle's transform options and nothing of the transformer
 * config, so a setting made in `metro.config.js` has no way to reach it on its own. This worker is
 * handed both, and puts the setting where the transformer looks. Metro computed a file's cache key
 * before this runs, so the list is in `cacheVersion` as well, where the preset puts it.
 */
function withLibraryStyles(config, options) {
  const packages = config.angularNativeLibraryStyles;
  // An empty list is carried too: it is the app saying no library's.
  if (!Array.isArray(packages)) return options;
  return {
    ...options,
    customTransformOptions: {
      ...options.customTransformOptions,
      angularNativeLibraryStyles: packages,
    },
  };
}

/** A stylesheet of a DOM component's page in a release build, which Expo writes out as a file. */
const isPageStylesheet = (filename, options) =>
  !options.dev &&
  options.platform === 'web' &&
  options.type !== 'asset' &&
  typeof options.customTransformOptions?.dom === 'string' &&
  IS_STYLESHEET.test(filename);

/**
 * Expo's stylesheet, with the files its `url()`s name exported: see `withExportedUrls`.
 *
 * Expo warns that each such `url()` is not supported. The warnings are held until it is known
 * whether every one was exported, and said only when one was not.
 */
async function pageStylesheet(expo, config, projectRoot, filename, data, options) {
  const held = holdUnsupported(filename);
  let result;
  try {
    result = await require(expo).transform(config, projectRoot, filename, data, options);
  } finally {
    held.stop();
  }
  const { getUniversalAssetData } = require(path.join(path.dirname(expo), 'getAssets'));
  const exported = await withExportedUrls(result, {
    filename,
    projectRoot,
    assetExts: config.angularNativeAssetExts ?? [],
    // As Expo's asset transformer asks for a DOM component's asset in an export.
    assetData: (file, local) =>
      getUniversalAssetData(file, local, config.assetPlugins, 'web', EXPORT_PUBLIC_PATH, true),
  });
  if (exported.left) for (const args of held.warnings) console.warn(...args);
  return exported.read.length
    ? { ...exported.result, [URL_FILES]: exported.read }
    : exported.result;
}

/** The sheets whose warnings are being held, and what `console.warn` was before the first. */
const holding = new Map();
let warn;

/**
 * Hold Expo's "not supported" warnings about `filename` until `stop()`. By the file the warning
 * names, and with `console.warn` put back only once no sheet is held: Metro transforms several
 * files at once in one process when it runs without workers.
 */
function holdUnsupported(filename) {
  const warnings = [];
  if (holding.size === 0) {
    warn = console.warn;
    console.warn = (...args) => {
      const message = String(args[0]);
      const about = UNSUPPORTED.test(message)
        ? [...holding].find(([file]) => message.includes(`(${file}:`))
        : undefined;
      if (about) about[1].push(args);
      else warn(...args);
    };
  }
  holding.set(filename, warnings);
  return {
    warnings,
    stop() {
      holding.delete(filename);
      if (holding.size === 0) console.warn = warn;
    },
  };
}

const UNSUPPORTED = /^Importing local resources in CSS is not supported yet/;

/** MUST MATCH `@expo/metro-config`'s `asset-transformer`, for a DOM component in an export. */
const EXPORT_PUBLIC_PATH = '/assets?export_path=assets';
/** Where a result carries the files its `url()`s named, as far as `transform` below. */
const URL_FILES = Symbol('urlFiles');

/** The file through Expo's worker, or through the one under it that runs our transformer. */
function transformFile(config, projectRoot, filename, data, options) {
  const expo = upstreamPath(config, projectRoot);
  options = withLibraryStyles(config, options);
  const page = domComponentPage(filename, options);
  if (page) return innerWorker(expo).transform(config, projectRoot, filename, page, options);

  const ours =
    options.dev &&
    options.platform !== 'web' &&
    options.type !== 'asset' &&
    IS_STYLESHEET.test(filename) &&
    !IS_CSS_MODULE.test(filename);
  if (!ours) {
    return isPageStylesheet(filename, options)
      ? pageStylesheet(expo, config, projectRoot, filename, data, options)
      : require(expo).transform(config, projectRoot, filename, data, options);
  }

  return innerWorker(expo).transform(config, projectRoot, filename, data, options);
}

module.exports = {
  // With the templates and stylesheets the transform read, so a cached one is not served once they
  // change: see `resource-cache.cjs`.
  transform(config, projectRoot, filename, data, options) {
    const result = transformFile(config, projectRoot, filename, data, options);
    const done = (output) => withResources(output, projectRoot, filename, output?.[URL_FILES]);
    return typeof result?.then === 'function' ? result.then(done) : done(result);
  },

  getCacheKey(config, context) {
    const expo = require(upstreamPath(config, context.projectRoot));
    return expo.getCacheKey?.(config, context) ?? '';
  },
};
