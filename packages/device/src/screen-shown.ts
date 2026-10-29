import { InjectionToken, type Signal, signal } from '@angular/core';

const ALWAYS = signal(true).asReadonly();

/**
 * Whether the screen something is on has appeared: false from the screen's creation until native
 * says it has appeared (react-native-screens' `appear` for a stack's screen, `didAppear` for a
 * tab's), and true from then on, whatever covers it later. A navigation outlet provides it for
 * each screen it shows, and a screen inside another's counts as shown once both are; outside an
 * outlet it is always true.
 *
 * For what native gets wrong when it is started on a view that is not yet laid out under its
 * bars: an iOS refresh control begun before then leaves a gap under a large title.
 */
export const SCREEN_SHOWN = new InjectionToken<Signal<boolean>>('angular-native.screenShown', {
  factory: () => ALWAYS,
});
