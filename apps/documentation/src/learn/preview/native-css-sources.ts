/**
 * The native CSS compiler's CommonJS files, as text, for `native-css.ts` to run. A module of their
 * own so they download with the WebAssembly, when there is CSS to check, rather than with the frame.
 */
import colorSpacesSource from '@ng-native/metro/css/color-spaces.cjs?raw';
import colourExpressionSource from '@ng-native/metro/css/colour-expression.cjs?raw';
import tokenArithmeticSource from '@ng-native/metro/css/token-arithmetic.cjs?raw';
import compileSource from '@ng-native/metro/css/compile.cjs?raw';
import filtersSource from '@ng-native/metro/css/filters.cjs?raw';
import gridSource from '@ng-native/metro/css/grid.cjs?raw';
import gradientsSource from '@ng-native/metro/css/gradients.cjs?raw';
import propertiesSource from '@ng-native/metro/css/properties.cjs?raw';
import shorthandsSource from '@ng-native/metro/css/shorthands.cjs?raw';
import valuesSource from '@ng-native/metro/css/values.cjs?raw';
import flattenSource from '@ng-native/tailwind/flatten.cjs?raw';

export const SOURCES: Readonly<Record<string, string>> = {
  './compile.cjs': compileSource,
  './values.cjs': valuesSource,
  './color-spaces.cjs': colorSpacesSource,
  './colour-expression.cjs': colourExpressionSource,
  './token-arithmetic.cjs': tokenArithmeticSource,
  './properties.cjs': propertiesSource,
  './gradients.cjs': gradientsSource,
  './shorthands.cjs': shorthandsSource,
  './filters.cjs': filtersSource,
  './grid.cjs': gridSource,
  './flatten.cjs': flattenSource,
};
