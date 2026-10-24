import { InjectionToken } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import { reactNative } from './react-native.ts';

/**
 * The operating system the app runs on: `Platform.OS` on a device, and `'web'` in the web host,
 * which provides it. Off a device, in a test in Node, it is the platform the engine renders as,
 * iOS unless `registerPlatformComponents` said otherwise.
 *
 * For a feature that depends on the platform, beside `OS_VERSION`, whose number is the API level
 * on Android: a check for iOS 26 needs both. A test provides the OS it wants.
 */
export const OS = new InjectionToken<'ios' | 'android' | 'web'>('angular-native.os', {
  factory: () => {
    const os = reactNative()?.Platform.OS ?? nativePlatform();
    return os === 'android' || os === 'web' ? os : 'ios';
  },
});
