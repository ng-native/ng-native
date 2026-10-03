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

/** The root outlet a page of another tab is presented in. */
export const PRESENTED = 'presented';

/** A lazily loaded route's children, once the router has loaded them. */
const loaded = (route: Route): Routes | undefined =>
  (route as { _loadedRoutes?: Routes })._loadedRoutes;

/**
 * How many of `segments` a route's path takes, or null when it does not match them or is one this
 * does not follow: a redirect, a custom matcher, a wildcard, or a route of another outlet.
 *
 * ponytail: static and `:param` segments only, which is what a page's url is made of. The rest
 * falls back to presenting the page where its url puts it, as before.
 */
function taken(route: Route, segments: readonly string[]): number | null {
  if (route.outlet && route.outlet !== PRIMARY_OUTLET) return null;
  if (route.redirectTo !== undefined || route.matcher || route.path === undefined) return null;
  const parts = route.path ? route.path.split('/') : [];
  if (parts.includes('**') || parts.length > segments.length) return null;
  const matches = parts.every((part, index) => part.startsWith(':') || part === segments[index]);
  return matches ? parts.length : null;
}

/** Whether a route is a page of its own: a component, and no children to choose among. */
const isPage = (route: Route, children: Routes | undefined): boolean =>
  !children && Boolean(route.component || route.loadComponent);

/**
 * The routes from the root to the one that shows `segments`, or null when the config has none
 * this can follow, a lazy route whose children are not loaded yet among them.
 */
function chainTo(routes: Routes, segments: readonly string[]): Route[] | null {
  for (const route of routes) {
    const count = taken(route, segments);
    if (count === null) continue;
    const rest = segments.slice(count);
    const children = route.children ?? loaded(route);
    const inside = children && chainTo(children, rest);
    if (inside) return [route, ...inside];
    if (!rest.length && isPage(route, children)) return [route];
  }
  return null;
}

/**
 * The page's route as a root route of the presented outlet: its own component, title, data and
 * resolvers, under the whole path, with the guards and providers of the routes it sat inside.
 * Their components are left out: the tab bar and the tab's stack are not what is presented.
 */
function presentedCopy(chain: readonly Route[]): Route {
  const page = chain.at(-1)!;
  const above = chain.slice(0, -1);
  return {
    ...page,
    path: chain
      .map((route) => route.path)
      .filter(Boolean)
      .join('/'),
    pathMatch: undefined,
    outlet: PRESENTED,
    canActivate: [
      ...above.flatMap((route) => [
        ...(route.canActivate ?? []),
        ...(route.canActivateChild ?? []),
      ]),
      ...(page.canActivate ?? []),
    ],
    providers: [...above.flatMap((route) => route.providers ?? []), ...(page.providers ?? [])],
    resolve: Object.assign({}, ...above.map((route) => route.resolve), page.resolve),
    data: Object.assign({}, ...above.map((route) => route.data), page.data),
  };
}

/** The copies each router has, by the path they match. */
const copies = new WeakMap<Router, Set<string>>();

/**
 * The commands that present the page at `path` in the root's presented outlet, having given its
 * route a copy there, or null when the config is not one this follows.
 */
export function presentedCommands(router: Router, path: string): unknown[] | null {
  const segments = path.split('/').filter(Boolean);
  const chain = chainTo(router.config, segments);
  if (!chain) return null;
  const copy = presentedCopy(chain);
  const known = copies.get(router) ?? new Set<string>();
  copies.set(router, known);
  if (!known.has(copy.path!)) {
    known.add(copy.path!);
    router.config.push(copy);
  }
  return [{ outlets: { [PRESENTED]: segments } }];
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
  const beside = extras.relativeTo?.pathFromRoot.some((route) => route.outlet === PRESENTED)
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
