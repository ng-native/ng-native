/**
 * `ngNativeWeb()`: the Vite preset for a browser app that renders `@ng-native/components` through
 * `@ng-native/web`.
 *
 * Two plugins, in this order:
 *
 * - `ng-native:config`, the resolution a browser build needs. React Native and Expo are reachable
 *   from the packages behind guards a browser never passes, but a bundler still resolves every
 *   specifier it sees, and React Native's source is Flow. Both resolve to an empty module.
 * - `@oxc-angular/vite`'s own plugins, for the app's components and for the linker, which handles
 *   the `@ng-native/*` packages as it handles every partial-compiled Angular library on npm.
 */
import { angular } from '@oxc-angular/vite';

/**
 * What the packages `require` on a device, behind a check a browser never passes. Only these: an
 * import of anything else native-only is a module a browser build really would need, so it fails
 * the build rather than the page.
 */
const NATIVE_ONLY = /^(react-native|expo)(\/|$)/;
const EMPTY = '\0ng-native:native-only';

/**
 * Resolves `react-native` and `expo` to an empty module, in the build and in the dependency
 * pre-bundle alike.
 *
 * Not `optimizeDeps.exclude` and `build.rolldownOptions.external`. The pre-bundle turns an
 * excluded package's `require` into a top-level import, so the page loaded React Native's Flow
 * source and failed on it. And an `external` of ours has to merge with one the app or a tool sets,
 * such as Storybook's array, which a function cannot join.
 *
 * @returns {import('vite').Plugin}
 */
function nativeOnly() {
  return {
    name: 'ng-native:native-only',
    resolveId: (id) => (NATIVE_ONLY.test(id) ? EMPTY : null),
    load: (id) => (id === EMPTY ? 'export {};' : null),
  };
}

/** @returns {import('vite').Plugin} */
function config() {
  return {
    ...nativeOnly(),
    name: 'ng-native:config',
    enforce: 'pre',
    config: () => ({ optimizeDeps: { rolldownOptions: { plugins: [nativeOnly()] } } }),
  };
}

/**
 * @param {import('@oxc-angular/vite').PluginOptions} [options] passed on to `@oxc-angular/vite`'s
 *   `angular()`, over `zoneless: true` and `emitClassMetadata: false`.
 * @returns {import('vite').Plugin[]}
 */
export function ngNativeWeb(options = {}) {
  return [config(), ...angular({ zoneless: true, emitClassMetadata: false, ...options })];
}
