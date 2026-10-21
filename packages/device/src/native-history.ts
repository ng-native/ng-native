import { InjectionToken } from '@angular/core';

/**
 * The history the native router keeps, where an app has one: `provideNativeRouter()` provides its
 * `PlatformLocation` here, and as `PlatformLocation` from here. A package that stands one in for an
 * app with no router reads this first, so the router's is kept in whichever order the two are
 * provided.
 */
export const NATIVE_HISTORY = new InjectionToken<object>('angular-native.nativeHistory');
