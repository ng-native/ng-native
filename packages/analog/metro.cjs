/**
 * The Metro config Analog's pages need, on top of `withAngularNative`.
 *
 * ```js
 * const { getDefaultConfig } = require('expo/metro-config');
 * const { withAngularNative } = require('@ng-native/metro/config.cjs');
 * const { withAnalog } = require('@ng-native/analog/metro');
 *
 * module.exports = withAnalog(withAngularNative(getDefaultConfig(__dirname)));
 * ```
 *
 * Two things. `require.context`, which finds the pages, is on: Expo turns it on already, and a
 * config that does not start from Expo's has it off. And `@analogjs/router`'s import of
 * `@analogjs/content` resolves to an empty module. It imports it for a Markdown page alone, with
 * an `import()` Metro resolves at build time whether or not a page is Markdown, so without it no
 * bundle builds where the package is not installed, and where it is, as npm installs it for being
 * a peer of the router, the bundle carries it and the Markdown parser behind it for nothing. The
 * app's own imports of it resolve as they do, and to an empty module when it is not installed.
 */

/** Marks a resolver this already wrapped, so applying it twice wraps it once. */
const WRAPPED = Symbol.for('ng-native.analog.resolveRequest');

/** A file of `@analogjs/router`, wherever the package manager put it. */
const ANALOG_ROUTER = /[\\/]@analogjs[\\/]router[\\/]/;

/**
 * @param {object} config a Metro config, usually `withAngularNative`'s
 * @returns {object} the same config
 */
function withAnalog(config) {
  config.transformer = { ...config.transformer, unstable_allowRequireContext: true };
  const next = config.resolver.resolveRequest;
  if (next?.[WRAPPED]) return config;
  const resolveRequest = (context, name, platform) => {
    const resolve = next ?? context.resolveRequest;
    if (name !== '@analogjs/content') return resolve(context, name, platform);
    if (ANALOG_ROUTER.test(context.originModulePath ?? '')) return { type: 'empty' };
    try {
      return resolve(context, name, platform);
    } catch {
      return { type: 'empty' };
    }
  };
  resolveRequest[WRAPPED] = true;
  config.resolver.resolveRequest = resolveRequest;
  return config;
}

module.exports = { withAnalog };
