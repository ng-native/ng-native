/**
 * The build half of `<dom-component>`: an Angular component rendered by a browser in a web view
 * inside a native screen. Expo calls the same idea, for React, a DOM component, and this ships the
 * Angular version through Expo's own pipeline, so Expo's dev server serves it and
 * `expo export:embed` puts it in a release build.
 *
 * An Angular DOM component is a file that starts with Expo's `'use dom'` directive and ends with
 * `export default mountInWebView(Component)`. Two things make Expo's pipeline carry it:
 *
 * - Imported from native code it is not compiled: it becomes `{ domComponent: '<page>' }`, with
 *   the page named exactly as Expo's `'use dom'` plugin names a DOM component's, and the same
 *   `expoDomComponentReference` metadata that plugin records. That metadata is how
 *   `export:embed` finds the pages to bundle into `www.bundle`; the name is where it writes them.
 * - Built for the web, Expo's page entry (`expo/dom/entry.js`) would mount the file's default
 *   export as a React component. For a DOM component it only loads the file, which mounts
 *   itself, after a listener that passes the page's early errors to the app.
 */
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Whether a file is an Angular DOM component: `'use dom'` first, and `mountInWebView` in it.
 *
 * The directive is Expo's own, shared with its React DOM components. What tells the two apart is
 * that Angular mounts the file; a React one never calls `mountInWebView`, and is left to Expo.
 */
function isAngularDomComponent(src) {
  return startsWithUseDom(src) && MOUNTS.test(src);
}

const MOUNTS = /\bmountInWebView\s*\(/;

/**
 * `'use dom'` as the file's first statement, after any whitespace and comments.
 *
 * A scan rather than one regular expression: every source file in the app passes through here, and
 * the obvious pattern (any run of whitespace or comments, repeated) backtracks exponentially on a
 * file that opens with a long comment, which once hung the bundler.
 */
function startsWithUseDom(src) {
  let at = 0;
  for (;;) {
    while (at < src.length && /\s/.test(src[at])) at++;
    if (src.startsWith('//', at)) {
      const end = src.indexOf('\n', at);
      if (end === -1) return false;
      at = end + 1;
    } else if (src.startsWith('/*', at)) {
      const end = src.indexOf('*/', at + 2);
      if (end === -1) return false;
      at = end + 2;
    } else {
      return src.startsWith("'use dom'", at) || src.startsWith('"use dom"', at);
    }
  }
}

/** What native code gets for `import note from './web/note.ts'`. */
function domComponentReference(filename, { dev }) {
  // MUST MATCH babel-preset-expo's use-dom-directive-plugin and @expo/cli's exportDomComponents.
  const reference = pathToFileURL(filename).href;
  const page = dev
    ? `${path.basename(filename)}?file=${reference}`
    : `${createHash('md5').update(reference).digest('hex')}.html`;
  return {
    code: `export default { domComponent: ${JSON.stringify(page)} };\n`,
    reference,
  };
}

/**
 * The page's entry: pass on anything thrown before Angular is up - an import that fails, a module
 * that throws as it loads - then load the component. Angular's `ErrorHandler` covers it after that.
 */
function domComponentEntry(relativeImport) {
  return `(function () {
  function report(error) {
    var message = error && error.message ? error.message + '\\n' + (error.stack || '') : String(error);
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'error', message: message })
    );
  }
  window.addEventListener('error', function (event) { report(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { report(event.reason); });
})();
require(${JSON.stringify(relativeImport)});
`;
}

/** A `url()`, quoted either way or bare. A quoted one can have a bracket in it. */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/g;
const urlIn = (double, single, bare) => double ?? single ?? bare;
/** A url that is not a file beside the sheet: inline data, a fragment, a rooted path, a scheme. */
const NOT_BESIDE = /^(data:|[#/]|[a-z][a-z0-9+.-]*:)/i;

/** Where a page's stylesheet is from its `www.bundle`: Expo writes it to `_expo/static/css`. */
const TO_BUNDLE_ROOT = '../../../';

/**
 * A page's stylesheet in a release build, with the files its `url()`s name exported beside it.
 *
 * Expo exports a page's stylesheet as it is written and none of what it refers to, so a font or an
 * image named by a relative `url()` loaded from Metro in development and was missing from a
 * release build. Each such file is made a dependency of the sheet's module, which puts it in the
 * page's bundle as an asset and so in `www.bundle`, and the `url()` is pointed at where Expo
 * writes it.
 *
 * Only a file Metro takes as an asset, by `assetExts`: anything else would be read as source.
 * A url left alone keeps Expo's warning that it is not supported.
 *
 * `assetData` is Expo's own `getUniversalAssetData`, so the name and its hash are the ones the
 * export uses. The path made from them MUST MATCH `@expo/metro-config`'s `asset-transformer`.
 *
 * Answers with the files it read as well: their hashes are in the sheet, so a cached transform of
 * it is stale once one changes (see `resource-cache.cjs`). And with how many `url()`s it left.
 */
async function withExportedUrls(result, options) {
  const css = result.output?.[0]?.data?.css;
  if (!css?.code) return { result, read: [], left: 0 };
  const { exported, left } = await exportedFiles(css.code, options);
  if (!exported.size) return { result, read: [], left };

  css.code = css.code.replace(CSS_URL, (whole, ...quoted) => {
    const url = urlIn(...quoted);
    const asset = exported.get(fileOf(url));
    const rest = url.slice(url.search(/[?#]|$/));
    return asset ? `url("${TO_BUNDLE_ROOT}${encodeURI(asset.path)}${rest}")` : whole;
  });
  const dependencies = [...exported.keys()].map(dependencyOn);
  return {
    result: { ...result, dependencies: [...result.dependencies, ...dependencies] },
    read: [...exported.values()].flatMap((asset) => asset.files),
    left,
  };
}

/** Each file the sheet's `url()`s name that the export writes, by the name the sheet gives it. */
async function exportedFiles(code, { filename, projectRoot, assetExts, assetData }) {
  const beside = path.dirname(path.resolve(projectRoot, filename));
  const exported = new Map();
  let left = 0;
  for (const [, ...quoted] of code.matchAll(CSS_URL)) {
    const file = fileOf(urlIn(...quoted));
    if (file === null || exported.has(file)) continue;
    const target = path.resolve(beside, file);
    const data = isAsset(target, assetExts)
      ? await assetData(target, path.relative(projectRoot, target))
      : null;
    // Without a 1x file there is no file of this name in the export, only `name@2x`.
    if (!data?.scales.includes(1)) {
      left++;
      continue;
    }
    const location = data.httpServerLocation.replace(/\.\.\//g, '_');
    // Every size of an image is in the hash, so each is a file the sheet was made from.
    exported.set(file, { files: data.files, path: `${location}/${data.name}.${data.type}` });
  }
  return { exported, left };
}

const isAsset = (file, assetExts) =>
  assetExts.includes(path.extname(file).slice(1).toLowerCase()) && existsSync(file);

/** A dependency of the sheet's module on a file beside it, as Metro's own transform records one. */
function dependencyOn(file) {
  const name = file.startsWith('.') ? file : `./${file}`;
  return {
    name,
    data: { asyncType: null, isESMImport: false, isOptional: false, locs: [], key: name },
  };
}

/** The file a `url()` names beside its sheet, without its query or fragment, or null. */
function fileOf(url) {
  if (NOT_BESIDE.test(url)) return null;
  try {
    return decodeURI(url.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
}

module.exports = {
  isAngularDomComponent,
  domComponentReference,
  domComponentEntry,
  withExportedUrls,
};
