/**
 * What `import 'expo'` is in a `macos` bundle, where no Expo package is.
 *
 * On iOS and Android `import 'expo'` installs Expo's runtime: a `fetch` whose response streams its
 * body, `URL` and `URLSearchParams` that follow the standard, `TextDecoderStream` and
 * `structuredClone`. These are its JavaScript-only parts, from the same files, installed the same
 * lazy way. The app keeps one entry file for every OS.
 *
 * TODO(desktop): a `fetch` whose `Response` has a streaming `body`, built on the Networking
 * module's incremental-data events (`didReceiveNetworkIncrementalData`), once the desktop host's
 * Networking sends them. Until then a Mac has React Native's own `fetch`, which reads the whole
 * body before it answers and has no `body` stream. `provideNativeHttpClient()` is unaffected.
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
