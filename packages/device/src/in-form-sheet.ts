import { InjectionToken } from '@angular/core';

/**
 * Whether the screen something is on was presented as a form sheet, directly or as a screen of a
 * stack in one. A navigation outlet provides it for each screen it shows; outside one it is false.
 *
 * For Android's defaults that assume a screen fills the window: a sheet never reaches the status
 * bar, and its drag only gives way to a scroll view with nested scrolling on.
 */
export const IN_FORM_SHEET = new InjectionToken<boolean>('angular-native.inFormSheet', {
  factory: () => false,
});
