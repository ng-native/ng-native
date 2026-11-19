/**
 * React Native's `Platform` on a desktop OS: its iOS one, reporting `os`.
 *
 * Expo resolves React Native's `Platform.ios.js` for a desktop OS, which says `'ios'`, and the
 * desktop host reports iOS-shaped constants, so everything else is the iOS object's: `Version`,
 * `constants`, `isPad` and the rest. `select` answers from `os`, then `ios`, then `native`, then
 * `default`, as the Babel plugin in `macos-babel.cjs` does for a select it can answer at build time.
 * `Platform.macos.js` and `Platform.linux.js` are this, for their OS.
 *
 * @param {object} ios React Native's iOS `Platform`
 * @param {string} os
 */
export function desktopPlatform(ios, os) {
  return Object.create(ios, {
    OS: { value: os, enumerable: true },
    select: {
      value: (spec) =>
        os in spec
          ? spec[os]
          : 'ios' in spec
            ? spec.ios
            : 'native' in spec
              ? spec.native
              : spec.default,
      enumerable: true,
    },
  });
}
