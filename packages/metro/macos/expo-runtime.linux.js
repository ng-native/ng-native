/**
 * What `import 'expo'` is in a `linux` bundle: the `Intl` polyfills (`./intl.js`), set to the
 * system's time zone where the desktop host's `NgNativeLocalization` reports one, then everything
 * `./expo-runtime.js` installs on macOS. Its imports resolve from the app, as that file's do.
 */
import '@ng-native/metro/macos/intl.js';
import { TurboModuleRegistry } from 'react-native';

export * from '@ng-native/metro/macos/expo-runtime.js';

const timeZone = TurboModuleRegistry.get('NgNativeLocalization')?.getCalendars?.()?.[0]?.timeZone;
if (typeof timeZone === 'string' && timeZone) Intl.DateTimeFormat.__setDefaultTimeZone?.(timeZone);
