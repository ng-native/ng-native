import { inject, type ProviderToken } from '@angular/core';
import type { ActivatedRouteSnapshot, CanDeactivate, CanDeactivateFn } from '@angular/router';

/** Anything a route's `canDeactivate` lists: a function, or the token of a guard class. */
type DeactivateGuard = CanDeactivateFn<unknown> | ProviderToken<CanDeactivate<unknown>>;

/** The routes of screens native has dismissed, as the router shows them now. */
const gone = new WeakSet<ActivatedRouteSnapshot>();

/** The guards `unlessGone` made, so a route's guards are wrapped once. */
const wrapped = new WeakSet<DeactivateGuard>();

/**
 * A guard that lets a route go without being asked once its screen is gone, and otherwise answers
 * as the guard it wraps. The router runs it in an injection context, as it runs any function guard.
 */
function unlessGone(guard: DeactivateGuard): DeactivateGuard {
  if (wrapped.has(guard)) return guard;
  const unless: CanDeactivateFn<unknown> = (component, route, state, next) => {
    if (gone.has(route)) return true;
    const own = inject(guard as ProviderToken<CanDeactivate<unknown>>, { optional: true });
    return own
      ? own.canDeactivate(component, route, state, next)
      : (guard as CanDeactivateFn<unknown>)(component, route, state, next);
  };
  wrapped.add(unless);
  return unless;
}

/**
 * Lets `route` and every route showing inside it go without asking their `canDeactivate` guards,
 * for a screen native has already dismissed. The screen does not come back, so a guard that
 * refused would hold the router on a page nobody can see.
 *
 * The router asks a route's guards through its config, so each guard there is wrapped, once, in
 * one that reads whether the route is gone. That is the route as the router shows it now: the next
 * navigation that succeeds shows new ones, whose guards are asked again.
 */
export function leaveUnasked(route: ActivatedRouteSnapshot): void {
  gone.add(route);
  const config = route.routeConfig;
  if (config?.canDeactivate?.length) {
    config.canDeactivate = (config.canDeactivate as DeactivateGuard[]).map(unlessGone);
  }
  for (const child of route.children) leaveUnasked(child);
}
