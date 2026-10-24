import { Platform } from '@angular/cdk/platform';
import type { Provider } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';

/**
 * The CDK's `Platform`, as a browser on the phone it is: none of the engines it has workarounds
 * for, and the operating system it is on. The CDK positions an overlay against its trigger only
 * where it is in a browser, and Material shows a tooltip for a held finger only on iOS or
 * Android.
 */
const platform: Platform = Object.defineProperties(
  Object.assign(Object.create(Platform.prototype) as Platform, {
    isBrowser: true,
    EDGE: false,
    TRIDENT: false,
    BLINK: false,
    WEBKIT: false,
    FIREFOX: false,
    SAFARI: false,
  }),
  {
    // Read when asked: the platform is registered as the app starts, after this is imported.
    IOS: { get: () => nativePlatform() === 'ios' },
    ANDROID: { get: () => nativePlatform() === 'android' },
  },
);

export const cdkOnAPhone: Provider = { provide: Platform, useValue: platform };
