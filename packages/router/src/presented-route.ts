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
  createEnvironmentInjector,
  runInInjectionContext,
  type EnvironmentInjector,
} from '@angular/core';
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
 * The page's route as a root route of the presented outlet: its own component, title, data and
 * resolvers, under the whole path, with the guards and providers of the routes it sat inside.
 * Their components are left out: the tab bar and the tab's stack are not what is presented.
 */
function presentedCopy(chain: readonly Route[], root: EnvironmentInjector | undefined): Route {
  const page = chain.at(-1)!;
  const above = chain.slice(0, -1);
  const scopeOf = root ? scopes(above, root) : undefined;
  // An ancestor's guard is run where it was: the copy has the providers of every route, and a
  // page's override of one that guard reads would otherwise decide it.
  const guarded = (route: Route, level: number, kind: 'canActivate' | 'canActivateChild') =>
    (route[kind] ?? []).map((guard: unknown) =>
      root && chain.slice(level + 1).some((below) => below.providers?.length)
        ? scoped(guard, kind, () => scopeOf!(level))
        : guard,
    ) as NonNullable<Route['canActivate']>;
  return {
    ...page,
    // Its own children are in the copy by now, where they were lazy.
    loadChildren: undefined,
    path: chain
      .map((route) => route.path)
      .filter(Boolean)
      .join('/'),
    pathMatch: undefined,
    outlet: PRESENTED,
    canActivate: [
      ...above.flatMap((route, level) => [
        ...guarded(route, level, 'canActivate'),
        ...guarded(route, level, 'canActivateChild'),
      ]),
      ...(page.canActivate ?? []),
    ],
    providers: [...above.flatMap((route) => route.providers ?? []), ...(page.providers ?? [])],
    resolve: Object.assign({}, ...above.map((route) => route.resolve), page.resolve),
    data: Object.assign({}, ...above.map((route) => route.data), page.data),
  };
}

/**
 * The injector each route above the page made, made when one of their guards first asks: its own
 * providers over those above it, the first over `root`.
 * ponytail: `root` stands for what a root route's injector is under; an ancestor inside a lazily
 * loaded NgModule leaves that module's providers out.
 */
function scopes(
  above: readonly Route[],
  root: EnvironmentInjector,
): (level: number) => EnvironmentInjector {
  const made: EnvironmentInjector[] = [];
  const scopeOf = (level: number): EnvironmentInjector => {
    if (level < 0) return root;
    const providers = above[level]!.providers;
    return (made[level] ??= providers?.length
      ? createEnvironmentInjector(providers, scopeOf(level - 1))
      : scopeOf(level - 1));
  };
  return scopeOf;
}

const NOT_FOUND = {};

/**
 * A guard run in `scope` as Angular runs one: a class or token as what `scope` gives for it, a
 * function in its injection context.
 */
function scoped(guard: unknown, kind: string, scope: () => EnvironmentInjector): unknown {
  return (...args: unknown[]) => {
    const injector = scope();
    const found = injector.get(guard as never, NOT_FOUND as never) as unknown;
    const value = (found === NOT_FOUND ? guard : found) as Record<string, unknown>;
    const method = value[kind];
    return typeof method === 'function'
      ? (method as (...a: unknown[]) => unknown).apply(value, args)
      : runInInjectionContext(injector, () =>
          (value as unknown as (...a: unknown[]) => unknown)(...args),
        );
  };
}

/**
 * The commands that present the page at `path` in the root's presented outlet, having given its
 * route a copy there, or null when the config is not one this follows.
 */
export async function presentedCommands(
  router: Router,
  path: string,
  root?: EnvironmentInjector,
): Promise<unknown[] | null> {
  // Parsed, so the routes are matched against decoded segments and the escapes are written once.
  const parsed = primarySegments(router, path);
  const segments = parsed.map((segment) => segment.path);
  const config = router.config;
  const chain = await chainTo(config, segments);
  // Routes reset while lazy children loaded: the copy is made from the routes the router has.
  if (router.config !== config) return presentedCommands(router, path, root);
  if (!chain || chain === STOP) return null;
  const copy = presentedCopy(chain, root);
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
