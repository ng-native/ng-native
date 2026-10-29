/**
 * A page presented over whatever is showing, when its url belongs to a tab that is not.
 *
 * The router puts a route where its url sits in the route tree: `/invoices/7` is the Invoices
 * tab's, so navigating there selects that tab and shows the page in its stack. A sheet over the
 * tab the user is on has to be somewhere else, and the router has a place for that, a named
 * outlet at the root. So the page's route gets a copy there, made the first time it is presented,
 * and `present()` navigates to the copy: `/home(presented:invoices/7)`. The router still runs the
 * navigation, so the page's guards, resolvers, lazy component and params are what they are in its
 * tab, and a back goes through history as any other does.
 */
import {
  PRIMARY_OUTLET,
  type NavigationExtras,
  type Route,
  type Router,
  type Routes,
  type UrlTree,
} from '@angular/router';
import { primarySegments, segmentCommands } from './url-commands.ts';

/** The root outlet a page of another tab is presented in. */
export const PRESENTED = 'presented';

/**
 * How many of `segments` a route's path takes, or null when it does not match them or is one this
 * does not follow: a redirect, a custom matcher, a wildcard, or a route of another outlet.
 *
 * ponytail: static and `:param` segments only, which is what a page's url is made of. The rest
 * falls back to presenting the page where its url puts it, as before.
 */
export function taken(route: Route, segments: readonly string[]): number | null {
  if (route.outlet && route.outlet !== PRIMARY_OUTLET) return null;
  if (route.redirectTo !== undefined || route.matcher || route.path === undefined) return null;
  const parts = route.path ? route.path.split('/') : [];
  if (parts.includes('**') || parts.length > segments.length) return null;
  const matches = parts.every((part, index) => part.startsWith(':') || part === segments[index]);
  return matches ? parts.length : null;
}

/** The children each lazily loaded route answered with, or null when they are not plain routes. */
const lazyChildren = new WeakMap<Route, Promise<Routes | null>>();

/**
 * A route's children, loading them when they are lazy. The router loads them again when it
 * navigates, from the same function, which a dynamic import answers from its cache.
 *
 * ponytail: a loader that answers routes, or a module whose default export is routes, as
 * `loadChildren: () => import('./invoices.routes')` does. An NgModule or an observable falls back
 * to presenting the page where its url puts it.
 */
function childrenOf(route: Route): Promise<Routes | null> | Routes | undefined {
  if (route.children || !route.loadChildren) return route.children;
  let loading = lazyChildren.get(route);
  if (!loading) {
    loading = Promise.resolve()
      .then(() => (route.loadChildren as () => unknown)())
      .then((answer) => {
        const routes = (answer as { default?: unknown } | null)?.default ?? answer;
        return Array.isArray(routes) ? (routes as Routes) : null;
      })
      // A loader that fails is the router's to report, when it navigates there as before.
      .catch(() => null);
    lazyChildren.set(route, loading);
  }
  return loading;
}

/** A route on the way that the copy cannot stand in for: the search stops, with no copy made. */
const STOP = Symbol('stop');

/** A route's children, or `STOP` where the copy cannot follow it: see `chainTo`. */
async function followable(route: Route): Promise<Routes | undefined | typeof STOP> {
  if (route.canMatch?.length) return STOP;
  return (await childrenOf(route)) ?? (route.loadChildren ? STOP : undefined);
}

/**
 * The routes from the root to the one that shows `segments`, null when none of `routes` leads
 * there, or `STOP` at a route with a `canMatch` guard. The router runs that guard against the
 * route and the segments it was matched with, which a copy under another path cannot give it,
 * and leaving it out would let the page match where its own route refuses to.
 */
async function chainTo(
  routes: Routes,
  segments: readonly string[],
): Promise<Route[] | null | typeof STOP> {
  for (const route of routes) {
    const count = taken(route, segments);
    if (count === null) continue;
    const rest = segments.slice(count);
    const children = await followable(route);
    if (children === STOP) return STOP;
    const inside = children && (await chainTo(children, rest));
    if (inside === STOP) return STOP;
    if (inside) return [route, ...inside];
    // A page of its own: a component, and no children to choose among.
    if (!rest.length && !children && (route.component || route.loadComponent)) return [route];
  }
  return null;
}

/**
 * The page's route as a root route of the presented outlet, under its whole path, inside a copy of
 * each route it sat inside: their guards, providers, resolvers and data, and not their components,
 * as the tab bar and the tab's stack are not what is presented. Angular makes one injector for each
 * of them, so a route's guards, the routes below it and the page share its providers' instances.
 *
 * Every route of the copy is in the presented outlet, and all but the first have an empty path: a
 * route without a component activates its children in its own parent's outlets, and Angular
 * matches the routes below one that took segments in the primary outlet.
 */
function presentedCopy(chain: readonly Route[]): Route {
  const path = chain
    .map((route) => route.path)
    .filter(Boolean)
    .join('/');
  const last = chain.length - 1;
  return chain.reduceRight<Route | undefined>((inside, route, level) => {
    const own: Route =
      level === last
        ? // Not the injector Angular made for it in its tab, which is under that tab's routes.
          ({ ...route, _injector: undefined } as Route)
        : {
            providers: route.providers,
            canActivate: route.canActivate,
            canActivateChild: route.canActivateChild,
            resolve: route.resolve,
            data: route.data,
            children: [inside!],
          };
    return { ...own, path: level ? '' : path, pathMatch: undefined, outlet: PRESENTED };
  }, undefined)!;
}

/**
 * The commands that present the page at `path` in the root's presented outlet, having given its
 * route a copy there, or null when the config is not one this follows.
 */
export async function presentedCommands(router: Router, path: string): Promise<unknown[] | null> {
  // Parsed, so the routes are matched against decoded segments and the escapes are written once.
  const parsed = primarySegments(router, path);
  const segments = parsed.map((segment) => segment.path);
  const config = router.config;
  const chain = await chainTo(config, segments);
  // Routes reset while lazy children loaded: the copy is made from the routes the router has.
  if (router.config !== config) return presentedCommands(router, path);
  if (!chain || chain === STOP) return null;
  const copy = presentedCopy(chain);
  const copied = router.config.some(
    (route) => route.outlet === PRESENTED && route.path === copy.path,
  );
  if (!copied) router.config.push(copy);
  return [{ outlets: { [PRESENTED]: parsed.flatMap(segmentCommands) } }];
}

/** `url` without the page presented over it: where the app is, under the page. */
export function withoutPresented(router: Router, url: string): string {
  // A named outlet is written `(name:path)`, so a url without that has no page to take off.
  if (!url.includes(`${PRESENTED}:`)) return url;
  const tree = router.parseUrl(url);
  delete tree.root.children[PRESENTED];
  return router.serializeUrl(tree);
}

/**
 * Where `commands` lead with the presented page left behind, when one is up and the commands are
 * not a presentation themselves; null otherwise. A navigation from a presented page goes to its
 * url's own place, which the page is over: left up, it would hide where the app went.
 */
export function leavingPresented(
  router: Router,
  commands: readonly unknown[],
  extras: NavigationExtras,
): UrlTree | null {
  // A named outlet is written `(name:path)`, so a url without that has no page up.
  if (!router.url?.includes(`${PRESENTED}:`)) return null;
  const first = commands[0] as { outlets?: Record<string, unknown> } | undefined;
  if (first?.outlets && PRESENTED in first.outlets) return null;
  const tree = router.createUrlTree([...commands], extras);
  // Commands relative to the page itself, as a link inside it gives them, resolve inside the
  // presented outlet: where they lead is that path in its own place, not beside the page.
  const start = commands[0];
  const absolute = typeof start === 'string' && start.startsWith('/');
  const beside =
    !absolute && extras.relativeTo?.pathFromRoot.some((route) => route.outlet === PRESENTED)
      ? tree.root.children[PRESENTED]
      : undefined;
  if (beside) {
    const path = beside.segments.map((segment) => segment.path);
    const { queryParams, fragment } = tree;
    const own = router.createUrlTree(['/', ...path], {
      queryParams,
      fragment: fragment ?? undefined,
    });
    delete own.root.children[PRESENTED];
    return own;
  }
  delete tree.root.children[PRESENTED];
  return tree;
}
