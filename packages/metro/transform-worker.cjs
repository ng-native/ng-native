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
const { isAngularDomComponent, domComponentEntry } = require('./dom-component.cjs');

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

module.exports = {
  transform(config, projectRoot, filename, data, options) {
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
    if (!ours) return require(expo).transform(config, projectRoot, filename, data, options);

    return innerWorker(expo).transform(config, projectRoot, filename, data, options);
  },

  getCacheKey(config, context) {
    const expo = require(upstreamPath(config, context.projectRoot));
    return expo.getCacheKey?.(config, context) ?? '';
  },
};
