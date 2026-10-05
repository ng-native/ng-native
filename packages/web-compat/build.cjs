/**
 * The build side of `@ng-native/web-compat`, for a Metro config and a Vitest config.
 *
 * A component library imports `NgIcon` from `@ng-icons/core`, whose component sets an icon's SVG
 * markup as `innerHTML`, which no native view draws. `@ng-native/icons` has a component of the
 * same name and inputs that draws the same icons as native shapes, but a library's own import
 * cannot be edited. So the import is resolved to a module that is `@ng-icons/core` with that one
 * component swapped, for the library and the app alike.
 */

/** `@ng-icons/core` with the icon component the native one. */
const SHIM = '@ng-native/web-compat/ng-icons';

/** The two packages that need the real `@ng-icons/core`: the shim, and the native icons. */
const OWN = /[\\/](@ng-native|packages)[\\/](web-compat|icons)[\\/]/;

/** What a module's import is resolved as in place of what it wrote, or null for as written. */
function aliasOf(moduleName, importer) {
  if (moduleName !== '@ng-icons/core') return null;
  return importer && OWN.test(importer) ? null : SHIM;
}

/**
 * A Metro config that resolves a library's `@ng-icons/core` to the native icons. Wrap the
 * config last, so a resolver another helper set is the one this goes through.
 */
function withWebCompat(config) {
  const own = config.resolver?.resolveRequest;
  const resolveRequest = (context, moduleName, platform) => {
    const resolve = own ?? context.resolveRequest;
    const alias = aliasOf(moduleName, context.originModulePath);
    return resolve(context, alias ?? moduleName, platform);
  };
  return { ...config, resolver: { ...config.resolver, resolveRequest } };
}

/** The same for Vitest, as a Vite plugin: `plugins: [ngNative(), webCompat()]`. */
function webCompat() {
  return {
    name: 'ng-native-web-compat',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const alias = aliasOf(source, importer);
      return alias ? this.resolve(alias, importer, { ...options, skipSelf: true }) : null;
    },
  };
}

module.exports = { aliasOf, withWebCompat, webCompat };
