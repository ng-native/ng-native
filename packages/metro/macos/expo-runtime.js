/**
 * What `import 'expo'` is in a `macos` bundle, where no Expo package is.
 *
 * On iOS and Android `import 'expo'` installs Expo's runtime: a `fetch` whose response streams its
 * body, `URL` and `URLSearchParams` that follow the standard, `TextDecoderStream` and
 * `structuredClone`. All but `fetch` are its JavaScript-only parts, from the same files, installed
 * the same lazy way. The app keeps one entry file for every OS.
 *
 * `fetch` is `./fetch.js`, over React Native's Networking module rather than Expo's native fetch
 * module, which a desktop host does not have. It is required by its package path because this
 * file's imports resolve from the app. As with Expo's runtime, `EXPO_PUBLIC_USE_RN_FETCH` set to
 * `1` or `true` leaves React Native's own `fetch` in place.
 */
import { installGlobal } from 'expo/internal/install-global';

installGlobal(
  'TextDecoderStream',
  () => require('expo/build/winter/TextDecoderStream.js').TextDecoderStream,
);
installGlobal(
  'TextEncoderStream',
  () => require('expo/build/winter/TextDecoderStream.js').TextEncoderStream,
);
installGlobal('URL', () => require('expo/build/winter/url.js').URL);
installGlobal('URLSearchParams', () => require('expo/build/winter/url.js').URLSearchParams);
installGlobal('DOMException', () => require('expo/build/winter/DOMException.js').DOMException);
installGlobal('structuredClone', () => require('@ungap/structured-clone').default);

const useRnFetch =
  process.env.EXPO_PUBLIC_USE_RN_FETCH === '1' || process.env.EXPO_PUBLIC_USE_RN_FETCH === 'true';
if (!useRnFetch) {
  // Reading `Headers` runs React Native's fetch polyfill first. It installs `Headers`, `Request`
  // and `Response` only while there is no global `fetch`, so after this one they stay missing.
  void globalThis.Headers;
  installGlobal('fetch', () =>
    require('@ng-native/metro/macos/fetch.js').createFetch(
      require('react-native/Libraries/Network/RCTNetworking').default,
    ),
  );
}
