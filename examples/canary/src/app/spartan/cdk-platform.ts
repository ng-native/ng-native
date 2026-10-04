import { Platform } from '@angular/cdk/platform';
import type { Provider } from '@angular/core';

/** The CDK's `Platform`, as a browser that is none of the ones it has workarounds for. */
const platform: Platform = Object.assign(Object.create(Platform.prototype) as Platform, {
  isBrowser: true,
  EDGE: false,
  TRIDENT: false,
  BLINK: false,
  WEBKIT: false,
  IOS: false,
  FIREFOX: false,
  ANDROID: false,
  SAFARI: false,
});

/**
 * The CDK positions an overlay against its trigger only where its own `Platform` says it is in a
 * browser, which it decides from Angular's platform id, and here that is `native`. With
 * `@ng-native/web-compat` it has everything it measures with, so it is told that it is.
 */
export const cdkInABrowser: Provider = { provide: Platform, useValue: platform };
