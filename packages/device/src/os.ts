import { InjectionToken, inject } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import { reactNative } from './react-native.ts';

/**
 * Every OS Angular Native runs on, as `Platform.OS` and the `OS` token name it. The one list the
 * OS types and checks derive from (`OS`, `ShortcutOs`, `TestOs`, `ModulePlatform`), so a new OS is
 * one entry here.
 */
export const OS_NAMES = ['ios', 'android', 'macos', 'linux', 'web'] as const;

/** One of `OS_NAMES`: what the `OS` token answers. */
export type OsName = (typeof OS_NAMES)[number];

/** Whether `os` is one of `OS_NAMES`. */
export const isOsName = (os: unknown): os is OsName =>
  (OS_NAMES as readonly unknown[]).includes(os);

/**
 * The operating system the app runs on: `Platform.OS` on a device, `'macos'` on a Mac, and `'web'`
 * in the web host, which provides it. Off a device, in a test in Node, it is the platform the engine
 * renders as, iOS unless `registerPlatformComponents` said otherwise.
 *
 * For a feature that depends on the platform, beside `OS_VERSION`, whose number is the API level
 * on Android and the macOS major on a Mac: a check for iOS 26 needs both, or it matches macOS 26
 * too. A test provides the OS it wants.
 */
export const OS = new InjectionToken<OsName>('angular-native.os', {
  factory: platformOs,
});

/**
 * The OS as React Native, or off a device the engine, reports it: what `OS` answers unprovided.
 * Throws on an OS not in `OS_NAMES`, which no check in the packages was written for: read as iOS,
 * as it once was, it would take iOS's shortcuts, sources and layout with no sign of why.
 */
export function platformOs(): OsName {
  const os = reactNative()?.Platform?.OS ?? nativePlatform();
  if (isOsName(os)) return os;
  throw new Error(
    `[angular-native] The platform reports the OS '${os}', which Angular Native does not run on. ` +
      `It runs on ${OS_NAMES.join(', ')}.`,
  );
}

/**
 * The `OS` a service is made under: the one provided, or, in an injector with no root to make it
 * in, the platform's own.
 */
export const injectOs = (): OsName => inject(OS, { optional: true }) ?? platformOs();

/** Whether `os` is a phone and tablet OS, with a status bar and a software keyboard. */
export const isPhoneOs = (os: string): boolean => os === 'ios' || os === 'android';

/** Whether `os` is a desktop OS, served by the desktop host: macOS or Linux. */
export const isDesktopOs = (os: string): boolean => os === 'macos' || os === 'linux';

/**
 * Whether the app runs on a desktop OS: macOS or Linux. Worked out from `OS`, so the two cannot
 * disagree, and a test that provides `OS` gets the answer that goes with it.
 */
export const DESKTOP = new InjectionToken<boolean>('angular-native.desktop', {
  factory: () => isDesktopOs(inject(OS)),
});

/**
 * Whether the app runs on one of Apple's OSes: iOS (iPadOS included) or macOS. For a check that
 * Apple's OSes share, written as `inject(APPLE)` rather than `OS === 'ios'`, which a Mac fails.
 * Worked out from `OS`, as `DESKTOP` is.
 */
export const APPLE = new InjectionToken<boolean>('angular-native.apple', {
  factory: () => {
    const os = inject(OS);
    return os === 'ios' || os === 'macos';
  },
});
