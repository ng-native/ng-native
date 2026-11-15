import { InjectionToken, type Provider, type Type } from '@angular/core';

/**
 * How `AppWindows` shows a route in a route window: each such window renders a named outlet of the
 * app's one Router, and this navigates that outlet. `@ng-native/router` provides it, since this
 * package cannot import the Router.
 */
export interface WindowNavigator {
  /**
   * What a route window for `outlet` renders: a component holding the outlet, and the providers
   * its window's root needs for the outlet to take that name.
   */
  window(outlet: string): { component: Type<unknown>; providers: Provider[] };
  /** Show `path` in the outlet named `outlet`. Resolves whether the navigation happened. */
  navigate(outlet: string, path: string): Promise<boolean>;
  /** Empty the outlet named `outlet`, as its window closes. Resolves whether it was emptied. */
  clear(outlet: string): Promise<boolean>;
}

/**
 * The router's `WindowNavigator`, or null in an app with no native router, where a route window
 * has nothing to show.
 */
export const WINDOW_NAVIGATOR = new InjectionToken<WindowNavigator | null>(
  'angular-native.windowNavigator',
  { factory: () => null },
);
