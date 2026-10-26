import { DestroyRef, inject } from '@angular/core';
import {
  PRIMARY_OUTLET,
  ResolveEnd,
  Router,
  type ActivatedRoute,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { OS } from '@ng-native/device';
import { NativeBack } from './native-back.ts';
import { navigationIntent } from './native-navigation.ts';
import { sameScreen } from './native-stack-reuse-strategy.ts';
import { PRESENTED } from './presented-route.ts';

/**
 * Refuse a navigation that would put a screen on iOS where it cannot show: on a stack further out
 * than one presenting a screen `fullScreenModal`.
 *
 * A full-screen modal takes everything under it out of the window, and react-native-screens' iOS
 * stack makes no change while it is out of the window: it waits to be back in it. So a screen
 * pushed or presented on the app's own stack, from a modal a tab's stack presented, never appears,
 * though the url says it is there, and the next back takes off the screen nobody saw. The
 * navigation is aborted once its routes are known, before the url changes, and resolves false.
 *
 * Only iOS refuses: Android's stack puts a nested stack's modal inside the screen holding it, so a
 * screen pushed over that one covers both. A replace or a reset takes the screen holding the modal
 * off the stack, and the modal with it.
 */
export function refuseScreensUnderFullScreen(): void {
  if (inject(OS) !== 'ios') return;
  const router = inject(Router);
  const back = inject(NativeBack);
  const events = router.events.subscribe((event) => {
    if (event instanceof ResolveEnd && hidden(router, back, event)) {
      router.currentNavigation()?.abort();
    }
  });
  inject(DestroyRef).onDestroy(() => events.unsubscribe());
}

/** Whether the navigation `event` reports puts a screen over one holding a full-screen modal. */
function hidden(router: Router, back: NativeBack, event: ResolveEnd): boolean {
  const modals = back.fullScreens();
  if (!modals.length) return false;
  const navigation = router.currentNavigation();
  if (!navigation) return false;
  const stack = navigationIntent(router, navigation)?.stack;
  if (stack === 'replace' || stack === 'reset') return false;
  // A navigation that is not a push goes back to a screen still on the stack where there is one.
  const pushing = navigation.trigger !== 'popstate' && stack === 'push';
  return arrivals(router.routerState.root, event.state.root).some(
    ({ covered, arriving }) =>
      back.onTopOfStack(covered) &&
      (pushing || !router.routeReuseStrategy.retrieve(arriving)) &&
      modals.some((modal) => modal !== covered && modal.pathFromRoot.includes(covered)),
  );
}

/**
 * Where the navigation to `target` changes what `current` shows: each screen it replaces in an
 * outlet, with the route arriving there. A page presented over everything covers the screen the
 * app's own stack shows.
 */
function arrivals(
  current: ActivatedRoute,
  target: ActivatedRouteSnapshot,
): { covered: ActivatedRoute; arriving: ActivatedRouteSnapshot }[] {
  return target.children.flatMap((next) => {
    const now = current.children.find((child) => child.outlet === next.outlet);
    if (now && sameScreen(next, now.snapshot)) return arrivals(now, next);
    const covered =
      now ??
      (next.outlet === PRESENTED
        ? current.children.find((child) => child.outlet === PRIMARY_OUTLET)
        : undefined);
    return covered ? [{ covered: screenOf(covered), arriving: screenOf(next) }] : [];
  });
}

/**
 * The route with a component at or under `route`: a route with none, a group or a `loadChildren`
 * wrapper, has the router put its child in its parent's outlet. A lazy component is not loaded
 * yet when the navigation's routes are known, so the config says.
 */
function screenOf<T extends ActivatedRoute | ActivatedRouteSnapshot>(route: T): T {
  let found: T = route;
  while (!(found.component ?? found.routeConfig?.loadComponent) && found.firstChild) {
    found = found.firstChild as T;
  }
  return found;
}
