import { PlatformLocation } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationError,
  NavigationStart,
  Router,
  type Event,
} from '@angular/router';
import { NativePlatformLocation } from './native-platform-location.ts';

/** Whether the router puts its url back for `event`, as it does for a navigation that failed. */
const rolledBack = (event: Event): event is NavigationError | NavigationCancel =>
  event instanceof NavigationError ||
  (event instanceof NavigationCancel &&
    event.code !== NavigationCancellationCode.Redirect &&
    event.code !== NavigationCancellationCode.SupersededByNewNavigation);

/**
 * Take out the history entry a navigation wrote before it failed or was refused.
 *
 * The router writes a navigation's url as it activates it, or as soon as it is recognised with
 * `urlUpdateStrategy: 'eager'`, and puts its own url back over that entry when the navigation then
 * fails. That leaves two entries for the page showing, and a Back from it goes to the same page.
 */
export function discardFailedEntries(): void {
  const history = inject(PlatformLocation);
  if (!(history instanceof NativePlatformLocation)) return;
  // As the navigation in flight found it. One ends before the next starts.
  let depth = 0;
  const events = inject(Router).events.subscribe((event) => {
    if (event instanceof NavigationStart) depth = history.ɵpages().length;
    else if (rolledBack(event) && history.ɵpages().length === depth + 1) history.ɵdiscard();
  });
  inject(DestroyRef).onDestroy(() => events.unsubscribe());
}
