/**
 * React Native's `Platform` in a `macos` bundle: its iOS one, reporting `'macos'`.
 *
 * Expo resolves React Native's `Platform.ios.js` for `macos`, which says `'ios'`, and the desktop
 * host reports iOS-shaped constants, so everything else here is the iOS object's: `Version`,
 * `constants`, `isPad` and the rest. `select` answers from `macos`, then `ios`, then `native`, then
 * `default`, as the Babel plugin in `macos-babel.cjs` does for a select it can answer at build time.
 */
import IOSPlatform from 'react-native/Libraries/Utilities/Platform.ios.js';

const Platform = Object.create(IOSPlatform, {
  OS: { value: 'macos', enumerable: true },
  select: {
    value: (spec) =>
      'macos' in spec
        ? spec.macos
        : 'ios' in spec
          ? spec.ios
          : 'native' in spec
            ? spec.native
            : spec.default,
    enumerable: true,
  },
});

export default Platform;
