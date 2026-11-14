import { InjectionToken } from '@angular/core';

/**
 * The name a route window's outlet takes: a route window's root is a `native-stack-outlet`, which
 * has no `name` attribute to read, so its window provides the name here. Every outlet provides it
 * again as null, so an outlet inside one, in a page of the window, is the primary outlet of its
 * page, as it would be anywhere else, and only the window's root reads the name.
 */
export const WINDOW_OUTLET = new InjectionToken<string | null>('angular-native.windowOutlet');
