import { InjectionToken } from '@angular/core';
import { reactNative } from './react-native.ts';

/**
 * The major version of the operating system the app runs on: 26 on iOS 26.5, and the API level
 * on Android. On Linux it is the distribution's, the major of its os-release `VERSION_ID`: 24 on
 * Ubuntu 24.04, 9 on AlmaLinux 9.4, and null on a rolling release such as Arch, which has none.
 * Null where there is none to ask, the web and a test in Node.
 *
 * For a default that follows what the platform draws in that version, where nothing native says
 * which it is. A test provides the version it wants.
 */
export const OS_VERSION = new InjectionToken<number | null>('angular-native.osVersion', {
  factory: () => {
    const version = Number.parseInt(String(reactNative()?.Platform.Version), 10);
    return Number.isNaN(version) ? null : version;
  },
});
