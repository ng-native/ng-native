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
 * config that does not start from Expo's has it off. And `@analogjs/content` resolves to an empty
 * module when the app has not installed it. `@analogjs/router` imports it for a Markdown page
 * alone, with an `import()` Metro resolves at build time whether or not a page is Markdown, so
 * without it no bundle builds. An app that installs it gets its own.
 */

/** Marks a resolver this already wrapped, so applying it twice wraps it once. */
const WRAPPED = Symbol.for('ng-native.analog.resolveRequest');

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
