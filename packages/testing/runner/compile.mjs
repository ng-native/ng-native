/**
 * The one decision both test runners make about a file: does Angular have to touch it before it
 * can run, and if so, what does it become.
 *
 * Shared by the Node hook (`loader.mjs`) and the Vitest plugin (`vitest.mjs`) so the two cannot
 * drift, and both delegate the compiling itself to `@ng-native/metro`'s `transformAngular` so a
 * test runs what Metro would have put in the app bundle rather than a lookalike.
 *
 * Two kinds of file need it, for the same reason - nothing downstream understands Angular:
 *
 * - A TypeScript source with an Angular decorator. Node's type stripping and Vite's both erase
 *   types and nothing else, and a decorator is syntax neither accepts. That covers an app's own
 *   components, a test file that declares one inline, and the `@ng-native/*` packages' source in
 *   this workspace.
 * - A package published partial-compiled. `@angular/common`, `@angular/router`, a published
 *   `@ng-native/*` package and most Angular libraries on npm are full of `ɵɵngDeclare*` calls, which compile eagerly at module evaluation
 *   and throw "needs to be compiled using the JIT compiler" without the linker.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const IS_SOURCE = /\.m?tsx?$/;
const HAS_ANGULAR_DECORATOR = /@(Component|Directive|Pipe|Injectable|NgModule|Service)\s*\(/;
/** Metro's own test, so a test links exactly the files an app bundle would. */
const IS_PARTIAL_COMPILED =
  /ɵɵngDeclare(Component|Directive|Pipe|Injectable|NgModule|Service|Factory)/;

/** @type {((source: string, file: string, options?: { platform?: string }) => { code: string, dependencies: string[], map?: string, mapLineOffset?: number }) | undefined} */
let transformAngular;

/**
 * @param {string} source
 * @param {string} file
 */
export function needsAngular(source, file) {
  return IS_SOURCE.test(file)
    ? HAS_ANGULAR_DECORATOR.test(source)
    : IS_PARTIAL_COMPILED.test(source);
}

/**
 * Compile or link one file. The output of a decorated source is still TypeScript: the runner's
 * own type stripping takes it from there, as Metro's babel preset does in an app.
 *
 * `dependencies` are the `templateUrl` and `styleUrls` files, as absolute paths, for a watcher.
 *
 * @param {string} source
 * @param {string} file
 * @param {{ platform?: string, libraryStyles?: string[], projectRoot?: string }} [options]
 *   `platform: 'web'` compiles as Metro does for a web view; `libraryStyles` as Metro's preset.
 * @returns {{ code: string, dependencies: string[], map?: string }}
 */
export function compileAngular(source, file, options = {}) {
  transformAngular ??= require('@ng-native/metro/angular-transform.cjs').transformAngular;
  const result = transformAngular(source, file, options);
  // Metro gets a module-graph edge to each template and stylesheet, as a bare `import "./x.html"`
  // it erases itself. Neither runner here knows what to do with one, and the content has already
  // been compiled in, so the edges are dropped. They are exactly the first `mapLineOffset` lines,
  // which also leaves the source map lined up with the code again.
  const code = result.mapLineOffset
    ? result.code.split('\n').slice(result.mapLineOffset).join('\n')
    : result.code;
  const directory = path.dirname(file);
  return {
    code: stubFonts(code),
    dependencies: result.dependencies.map((dependency) => path.resolve(directory, dependency)),
    map: result.map,
  };
}

/**
 * `require('./logo.png')`, which Metro turns into an asset id. An ES module has no `require` under
 * Vitest or under Node, so the module would throw as it is evaluated; it gets `{ testUri }`
 * instead, as under React Native's Jest preset, which is enough for a component to render and for
 * a test to see which image. Only an app's own files: a package's are left as they are.
 */
const ASSET =
  /\brequire\(\s*(['"])([^'"]+\.(?:png|jpe?g|gif|webp|bmp|svg|ttf|otf|mp3|mp4|wav|m4a|mov|json5?))\1\s*\)/g;
/** @param {string} code */
/**
 * The `require` the compiler writes for the file a stylesheet's `@font-face` names, which is in no
 * source a caller could have stubbed and has no `require` to run with either. Matched by where it
 * sits in a compiled sheet, so whatever the file is called, and nothing a package wrote itself.
 */
const FONT = /"source":require\(("(?:[^"\\]|\\.)*")\)/g;
/** @param {string} code */
const stubFonts = (code) => code.replace(FONT, (_, path) => `"source":({ testUri: ${path} })`);

export const stubAssets = (code) =>
  code.replace(ASSET, (_, _quote, path) => `({ testUri: ${JSON.stringify(path)} })`);
