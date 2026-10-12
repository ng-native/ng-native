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
 *
 * Between the two, a `localStorage` and a `sessionStorage` where the web view has none. Android's
 * answers `null` for both until DOM storage is turned on, and `@expo/dom-webview` does not turn it
 * on, so web code that reads one as it starts threw there and ran on iOS. Here rather than in
 * `mountInWebView`, so a module that reads storage as it loads finds it too.
 *
 * ponytail: the stand-in is memory, so it lasts as long as the page, and it has storage's methods
 * and not its named properties (`localStorage.theme`). Keeping it across launches means carrying
 * it over the bridge to a store in the app.
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
(function () {
  function storage() {
    var items = Object.create(null);
    return {
      get length() { return Object.keys(items).length; },
      key: function (index) { var name = Object.keys(items)[index]; return name === undefined ? null : name; },
      getItem: function (name) { return name in items ? items[name] : null; },
      setItem: function (name, value) { items[name] = String(value); },
      removeItem: function (name) { delete items[name]; },
      clear: function () { items = Object.create(null); },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      if (window[name]) return;
    } catch (refused) {}
    Object.defineProperty(window, name, { configurable: true, value: storage() });
  });
})();
require(${JSON.stringify(relativeImport)});
`;
}

module.exports = { isAngularDomComponent, domComponentReference, domComponentEntry };
