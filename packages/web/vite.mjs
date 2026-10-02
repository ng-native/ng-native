/**
 * `ngNativeWeb()`: the Vite preset for a browser app that renders `@ng-native/components` through
 * `@ng-native/web`.
 *
 * Two plugins, in this order:
 *
 * - `ng-native:config`, the resolution a browser build needs. React Native and Expo are reachable
 *   from the packages behind guards a browser never passes, but a bundler still resolves every
 *   specifier it sees, and React Native's source is Flow. Both resolve to an empty module, and a
 *   Expo module a package `require`s, such as `expo-battery`, to one that throws. Reanimated,
 *   worklets and gesture-handler resolve to inert stand-ins, so a component that builds a gesture
 *   or an animation builds for the browser too.
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
 * The native modules `@ng-native/expo` reaches through a `require` inside a `catch`:
 * `expo-battery`, `expo-modules-core`, `@react-native-async-storage/async-storage`,
 * `react-native-watch-connectivity`. Not every `react-native-*`: `@ng-native/components` requires
 * Reanimated and gesture-handler outside any `catch`, where a module that throws would fail the
 * page rather than the build. A `require` of one resolves to a module that throws when it is
 * evaluated, so the `catch` answers as it does where the module is missing, and the service is
 * inert. An `import` of one still resolves as usual, and fails the build when it is not installed.
 */
const NATIVE_MODULE =
  /^(expo-|@expo\/|@react-native-async-storage\/|react-native-watch-connectivity$)/;
const MISSING = '\0ng-native:missing:';

/**
 * The libraries an app imports itself for gestures and worklet animations, and the stand-in each
 * resolves to in a browser, where there is no native recogniser and no UI-thread runtime: an
 * animation lands where it ends, a gesture recognises nothing, and work scheduled for either
 * runtime runs at once. Installed or not, since the libraries reach React Native's source.
 */
const STAND_INS = {
  'react-native-reanimated': '@ng-native/components/stand-ins/reanimated',
  'react-native-worklets': '@ng-native/components/stand-ins/worklets',
  'react-native-gesture-handler': '@ng-native/components/stand-ins/gesture-handler',
};

/**
 * Resolves `react-native` and `expo` to an empty module, and a `require` of an Expo module to one
 * that throws, in the build and in the dependency pre-bundle alike.
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
    resolveId(id, importer, options) {
      // From the importer: `@ng-native/components` is the app's, not this package's.
      // As resolved, so the dependency scan takes the stand-in as a dependency to pre-bundle.
      if (Object.hasOwn(STAND_INS, id))
        return this.resolve(STAND_INS[id], importer, { skipSelf: true });
      if (NATIVE_ONLY.test(id)) return EMPTY;
      if (options?.kind === 'require-call' && NATIVE_MODULE.test(id)) return MISSING + id;
      return null;
    },
    load: (id) => {
      if (id === EMPTY) return 'export {};';
      if (!id.startsWith(MISSING)) return null;
      const message = `${id.slice(MISSING.length)} is native-only, so not in a browser build`;
      return `throw new Error(${JSON.stringify(message)});`;
    },
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
