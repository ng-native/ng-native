/**
 * Metro babel transformer: Angular first, then Expo's stock transformer (which wraps
 * `@react-native/babel-preset` and does the TypeScript stripping oxc-angular does not).
 */
const { inlineIcons } = require('./inline-icons.cjs');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const upstream = expoTransformer();
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
const { transformAngular } = require('./angular-transform.cjs');
const { isAngularDomComponent, domComponentReference } = require('./dom-component.cjs');

/**
 * Expo's transformer, from wherever the app's `expo` has it. pnpm and most npm installs hoist
 * `@expo/metro-config` beside this package, but npm can nest it under `expo` instead, where only
 * `expo` itself can reach it.
 */
function expoTransformer() {
  const id = '@expo/metro-config/build/babel-transformer';
  try {
    return require(id);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const expo = path.dirname(require.resolve('expo/package.json', { paths: [process.cwd()] }));
    return require(require.resolve(id, { paths: [expo] }));
  }
}

/**
 * Metro keys its persistent cache on the transformer's own key, and upstream's knows nothing
 * about ours. Without this, editing the Angular transform or the CSS compiler leaves every
 * previously transformed module cached against the old rules, and the symptom is an error message
 * quoting code that no longer exists, or a release build still carrying what was just stripped.
 */
/**
 * Every `.cjs` this package ships, found rather than listed.
 *
 * This was a hand-written list of five files, and it went stale the moment the CSS compiler grew
 * past them: `css/gradients.cjs` was never in it, so months of edits to the gradient compiler
 * changed nothing an app saw. The symptom is the worst kind - the code is right, the tests pass,
 * and the device shows the old behaviour, so the search goes anywhere but here.
 *
 * A list that has to be maintained to stay correct will not stay correct. Reading the directory
 * cannot go out of date.
 */
function ownSources(dir = __dirname, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') ownSources(full, found);
    } else if (entry.name.endsWith('.cjs')) {
      found.push(full);
    }
  }
  return found;
}

const OWN_SOURCES = ownSources();

const ownVersion = createHash('sha1')
  .update(OWN_SOURCES.map((file) => readFileSync(file)).join('\0'))
  .digest('hex')
  .slice(0, 12);

/**
 * Point the AST back at the file someone wrote.
 *
 * Metro builds its source map from the positions on the AST it is handed, and those describe our
 * *compiled* output: the decorator block has gone, an import has arrived, a template has become a
 * stream of instructions. Left alone, every line number in a stack trace, a warning or a debugger
 * is wrong - by 34 lines in one of the canary's pages, and by a different amount in every file.
 *
 * So each node's position is looked up in the compiler's own map and rewritten in place. A node
 * with no original position is generated code - the template instructions, mostly - and loses its
 * position rather than keeping a misleading one; the generator then maps it to the nearest node
 * that has one.
 */
function remapPositions(node, tracer, lineOffset) {
  if (Array.isArray(node)) {
    for (const item of node) remapPositions(item, tracer, lineOffset);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const loc = node.loc;
  if (loc && loc.start && typeof loc.start.line === 'number') {
    node.loc = originalLoc(loc, tracer, lineOffset);
  }
  for (const key of Object.keys(node)) {
    if (key !== 'loc') remapPositions(node[key], tracer, lineOffset);
  }
}

function originalLoc(loc, tracer, lineOffset) {
  // The resource imports put in front of the compiled code have no original, and the map has no
  // line 0 to ask about.
  if (loc.start.line - lineOffset < 1) return null;
  const start = originalPositionFor(tracer, {
    line: loc.start.line - lineOffset,
    column: loc.start.column,
  });
  if (start.line == null) return null;
  const end = originalPositionFor(tracer, {
    line: loc.end.line - lineOffset,
    column: loc.end.column,
  });
  return {
    start: { line: start.line, column: start.column },
    end:
      end.line == null
        ? { line: start.line, column: start.column }
        : { line: end.line, column: end.column },
    filename: loc.filename,
    identifierName: loc.identifierName,
  };
}

/**
 * The preset's `libraryStyles`, which the transform worker it installs puts into the bundle's
 * `customTransformOptions`.
 *
 * A config that replaced that worker after `withAngularNative` leaves them out, and the option
 * would do nothing without a word. The preset also leaves the list in the environment its workers
 * inherit, so a file of a listed package that arrives without it is said to, once a build.
 */
function libraryStylesOf(params) {
  const carried = params.options?.customTransformOptions?.angularNativeLibraryStyles;
  if (carried || warnedWorker) return carried;
  const expected = process.env['ANGULAR_NATIVE_LIBRARY_STYLES']?.split(',').filter(Boolean) ?? [];
  const listed = expected.find((name) =>
    params.filename.split(path.sep).join('/').includes(`/node_modules/${name}/`),
  );
  if (listed) {
    warnedWorker = true;
    console.warn(
      `[angular-native] libraryStyles names '${listed}', but ${params.filename} arrived without ` +
        "the list, so the library's components have no sheets. Metro is running a transform " +
        'worker other than the one withAngularNative installs, which is the only way the list ' +
        'reaches the transformer: something set transformerPath after withAngularNative.',
    );
  }
  return carried;
}

let warnedWorker = false;

/**
 * The Angular stage, or the file's own syntax error when that is why it failed.
 *
 * The Angular compiler parses the file first, and a plain TypeScript mistake comes back from it as
 * "Unexpected token" with no line, no column and no code frame. Babel reports the same mistake
 * with all three, so when the Angular stage fails, the file is handed to Babel as written: if it
 * cannot parse either, its error is the one to show. If it can, the fault is in a template or a
 * stylesheet, and the Angular error stands.
 */
function angularOrSyntaxError(params) {
  try {
    return transformAngular(params.src, params.filename, {
      dev: params.options?.dev === true,
      platform: params.options?.platform,
      // From the preset's `libraryStyles`, by way of the transform worker: see `transform-worker.cjs`.
      libraryStyles: libraryStylesOf(params),
      projectRoot: params.options?.projectRoot,
    });
  } catch (error) {
    try {
      upstream.transform(params);
    } catch (syntaxError) {
      if (syntaxError?.loc) throw syntaxError;
    }
    throw error;
  }
}

module.exports = {
  ...upstream,
  getCacheKey(...args) {
    return `${upstream.getCacheKey?.(...args) ?? ''}${ownVersion}`;
  },
  transform(params) {
    // A DOM component imported from native code is a reference to its page, not a component: see
    // `dom-component.cjs`.
    if (params.options?.platform !== 'web' && isAngularDomComponent(params.src)) {
      const { code, reference } = domComponentReference(params.filename, {
        dev: params.options?.dev !== false,
      });
      const result = upstream.transform({ ...params, src: code });
      result.metadata = { ...result.metadata, expoDomComponentReference: reference };
      return result;
    }
    params = { ...params, src: inlineIcons(params.src, params.filename) };
    const { code, map, mapLineOffset } = angularOrSyntaxError(params);
    const result = upstream.transform({ ...params, src: code });
    if (map && result.ast) {
      remapPositions(result.ast, new TraceMap(JSON.parse(map)), mapLineOffset ?? 0);
    }
    return result;
  },
};
