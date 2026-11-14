import { InjectionToken, inject } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import { reactNative } from './react-native.ts';

/**
 * The operating system the app runs on: `Platform.OS` on a device, `'macos'` on a Mac, and `'web'`
 * in the web host, which provides it. Off a device, in a test in Node, it is the platform the engine
 * renders as, iOS unless `registerPlatformComponents` said otherwise.
 *
 * For a feature that depends on the platform, beside `OS_VERSION`, whose number is the API level
 * on Android and the macOS major on a Mac: a check for iOS 26 needs both, or it matches macOS 26
 * too. A test provides the OS it wants.
 */
export const OS = new InjectionToken<'ios' | 'android' | 'macos' | 'web'>('angular-native.os', {
  factory: platformOs,
});

/** The OS as React Native, or off a device the engine, reports it: what `OS` answers unprovided. */
function platformOs(): 'ios' | 'android' | 'macos' | 'web' {
  const os = reactNative()?.Platform.OS ?? nativePlatform();
  return os === 'android' || os === 'macos' || os === 'web' ? os : 'ios';
}

/**
 * The `OS` a service is made under: the one provided, or, in an injector with no root to make it
 * in, the platform's own.
 */
export const injectOs = (): 'ios' | 'android' | 'macos' | 'web' =>
  inject(OS, { optional: true }) ?? platformOs();

/** Whether `os` is a phone and tablet OS, with a status bar and a software keyboard. */
export const isPhoneOs = (os: string): boolean => os === 'ios' || os === 'android';

/**
 * Whether the app runs on a desktop OS: macOS today. Worked out from `OS`, so the two cannot
 * disagree, and a test that provides `OS` gets the answer that goes with it.
 */
export const DESKTOP = new InjectionToken<boolean>('angular-native.desktop', {
  factory: () => inject(OS) === 'macos',
});
