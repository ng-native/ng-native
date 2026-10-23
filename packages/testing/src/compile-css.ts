import type { StyleSheet } from '@ng-native/fabric';

export interface CompileCssOptions {
  /**
   * Told of each declaration or rule native cannot express, which is then left out. With none, the
   * first one throws, so a test never passes on a sheet that quietly lost a rule.
   */
  readonly onUnsupported?: (message: string) => void;
  /**
   * Read the sheet as the browser it was written for reads it, as the build reads a library's
   * stylesheet: `::before` and `::after` as boxes of their own, `visibility`, a clip to nothing and
   * the rest an app's own sheet is told to write another way.
   */
  readonly generated?: boolean;
}

/**
 * A stylesheet compiled as the build compiles an app's, for `render()`'s `globalStyles`:
 * `render(Badge, { globalStyles: compileCss(':root { --brand: red }') })`.
 *
 * The compiler is `@ng-native/metro`'s, which this package depends on and a test file in a
 * workspace library cannot always resolve for itself. Loaded when called, and through Node's own
 * `require`: it is CommonJS, and nothing but a test needs it.
 */
export function compileCss(
  css: string,
  name = 'test',
  options: CompileCssOptions = {},
): StyleSheet {
  const { createRequire } = process.getBuiltinModule('node:module');
  const compiler = createRequire(import.meta.url)('@ng-native/metro/css/compile.cjs') as {
    compileCss(css: string, name: string, options: CompileCssOptions): StyleSheet;
  };
  return compiler.compileCss(css, name, options);
}
