import { inject, type Signal } from '@angular/core';
import { SCREEN_IN_FRONT } from '@ng-native/device';

/**
 * Whether the page calling this is the one showing: true while its tab is selected and nothing is
 * stacked over it, and false while it stays mounted behind another page or tab. It does not follow
 * the app going to the background, which `AppState` from `@ng-native/device` does. Outside an
 * outlet it is always true. `SCREEN_IN_FRONT` under the name a page looks for.
 */
export function injectPageFocused(): Signal<boolean> {
  return inject(SCREEN_IN_FRONT);
}
