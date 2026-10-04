/**
 * The reuse strategy that turns navigation into a stack.
 *
 * Angular's default strategy never detaches, so navigating away destroys the component and its
 * native views, and coming back rebuilds them from scratch: a list is back at the top, a form is
 * empty. Detaching instead hands the live `ComponentRef` to the outlet, which keeps its screen
 * mounted. That is the whole reason `RouterOutletContract.detach()` exists.
 *
 * No decorators, so tests can import it and so it can be provided with `useClass`.
 */
import { Injector, inject, type ComponentRef } from '@angular/core';
import {
  BaseRouteReuseStrategy,
  type ActivatedRouteSnapshot,
  type DetachedRouteHandle,
  Router,
  type Route,
} from '@angular/router';
import { intentOf } from './native-navigation.ts';
import { PRESENTED } from './presented-route.ts';
import { isScreenRoute, isTabRoute } from './tab-routes.ts';

/**
 * Where `reuseScreen` marks a route. On the config's `data` rather than in a set of configs,
 * because the router copies every route config it is given, so the object an app wrote is never
 * the one a snapshot points at.
 */
const REUSE_SCREEN = 'ɵreuseScreen';

/**
 * Keep one screen for a route whatever its parameters, updating it in place as Angular's own
 * strategy does, instead of pushing a new screen for each url.
 *
 * `reuseScreen({ path: 'photo/:index', component: Photo })` for a route whose parameter picks
 * what one screen shows - a pager, a step through a list - rather than naming another screen to
 * go to. Everything else stacks: `/user/1` then `/user/2` is two screens, and back returns to the
 * first.
 */
export function reuseScreen<T extends Route>(route: T): T {
  return { ...route, data: { ...route.data, [REUSE_SCREEN]: true } };
}

/** What the router actually stores: `DetachedRouteHandle` is typed as an opaque object. */
interface StoredHandle {
  readonly componentRef?: ComponentRef<unknown>;
}

/**
 * Identify a screen by its resolved url rather than its route config, so `/user/1` and `/user/2`
 * are two screens on the stack rather than one that gets reused.
 *
 * One entry per level of the route tree, empty ones included. Flattened to a url, a tab at
 * `/tabs/library` and the list at path `''` beneath it are the same string, and the router, asking
 * for the list, is handed the tab's whole tree and makes the tab its own child.
 */
function keyOf(route: ActivatedRouteSnapshot): string {
  const levels: string[] = [];
  for (let current: ActivatedRouteSnapshot | null = route; current; current = current.parent) {
    levels.unshift(current.url.map((segment) => segment.toString()).join('/'));
  }
  return JSON.stringify(levels);
}

function injectorHere(): Injector | null {
  try {
    return inject(Injector);
  } catch {
    return null;
  }
}

export class NativeStackReuseStrategy extends BaseRouteReuseStrategy {
  /**
   * The screens kept for each url, oldest first. More than one where the same url is on the stack
   * twice: a customer, one of its jobs, and the customer again from the job.
   */
  private readonly handles = new Map<string, DetachedRouteHandle[]>();
  /**
   * For the navigation in flight, read when it is asked for: the router is built from this. Null
   * where the strategy is made by hand, outside an injector, and every navigation is then plain.
   */
  private readonly injector = injectorHere();

  /**
   * Only leaf routes become screens; a parent with children is layout, not a destination.
   *
   * A tab is the exception, and has to be. Detaching only its leaf would rebuild the tab itself
   * on every switch, and with it the stack outlet inside: a tab two screens deep would come back
   * one screen deep, having lost the screens the user could go back to. Detaching the tab keeps
   * its whole subtree, which is what makes each tab remember where it was.
   *
   * So is a parent a native stack put on screen, such as a root stack's tab bar: a sheet presented
   * over it has to leave it standing (see `markScreenRoute`).
   */
  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    if (route.component === null) return false;
    // A page presented over the tabs is dismissed, not kept: nothing goes back to it.
    if (route.outlet === PRESENTED) return false;
    return (
      route.children.length === 0 ||
      isTabRoute(route.routeConfig) ||
      isScreenRoute(route.routeConfig)
    );
  }

  override store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = keyOf(route);
    const kept = this.handles.get(key) ?? [];
    if (handle) {
      // The same screen stored again takes its place at the end, not a second one.
      this.handles.set(key, [...kept.filter((one) => one !== handle), handle]);
      this.forgetOnDestroy((handle as StoredHandle).componentRef);
      return;
    }
    // The router has re-attached the one `retrieve` answered with: the last.
    if (kept.length > 1) this.handles.set(key, kept.slice(0, -1));
    else this.handles.delete(key);
  }

  private readonly watched = new WeakSet<ComponentRef<unknown>>();

  /**
   * Drop a screen's handles the moment its component is destroyed.
   *
   * The router stores a handle for every screen it navigates away from, the one being popped
   * included, and the outlet then destroys that screen. A handle outlives its component, and holds
   * the component's whole view and every native node in it; `retrieve` notices only when the same
   * url is asked for again, so a url never revisited kept its last screen for as long as the app
   * ran.
   */
  private forgetOnDestroy(ref: ComponentRef<unknown> | undefined): void {
    if (!ref || this.watched.has(ref)) return;
    this.watched.add(ref);
    ref.onDestroy(() => {
      for (const [key, kept] of this.handles) {
        const left = kept.filter((handle) => (handle as StoredHandle).componentRef !== ref);
        if (left.length) this.handles.set(key, left);
        else this.handles.delete(key);
      }
    });
  }

  /**
   * Angular reuses a route whenever its config is the same, so on the web `/user/1` to `/user/2`
   * keeps the one component and feeds it the new params. On a native stack that turns a push into
   * an update in place: no push animation, one screen, and back skipping past `/user/1`. A screen
   * a stack put on screen is reused only when its url is the same too, so a different parameter
   * is a different screen, which the router detaches and stores as it does any screen pushed
   * away. A query or fragment change is not part of the url that identifies a screen, and a
   * parent that is only layout is reused as before, so its stack keeps what is in it.
   */
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig !== curr.routeConfig) return false;
    const config = curr.routeConfig;
    const reuse =
      !isScreenRoute(config) ||
      config?.data?.[REUSE_SCREEN] === true ||
      keyOf(future) === keyOf(curr);
    if (reuse) this.reused.add(future);
    return reuse;
  }

  /** The routes the navigation in flight keeps as they are, by the snapshot it is building. */
  private readonly reused = new WeakSet<ActivatedRouteSnapshot>();

  /**
   * Whether the router goes back to a kept screen for this url. Not for a push: a push to a url
   * already on the stack is a new screen over it, as a native stack makes one, and Back returns
   * to where the push came from. Going back to the kept one is a back, or `popTo`.
   *
   * Never for a route with no component, which is never kept: the router asks for every route,
   * and a group at path `''` has the same url as a page at `''` beside it, whose screen it would
   * otherwise be handed.
   *
   * A tab is attached for a push too: the push is into the tab's own stack, which is kept with it,
   * and building the tab again would leave a second stack in the tab's screen. Only into the bar
   * already showing, though: a push that builds another bar over it builds its tabs too, and the
   * one kept at the same url is the bar beneath's.
   */
  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    if (route.component === null) return false;
    if (this.pushing() && !(isTabRoute(route.routeConfig) && this.inKeptBar(route))) return false;
    return this.retrieve(route) !== null;
  }

  /** Whether the tab bar above a tab's route is one the navigation keeps rather than builds. */
  private inKeptBar(route: ActivatedRouteSnapshot): boolean {
    let bar = route.parent;
    while (bar && bar.component === null) bar = bar.parent;
    return bar !== null && this.reused.has(bar);
  }

  private pushing(): boolean {
    const navigation = this.injector?.get(Router).currentNavigation();
    // A back restores the state its history entry was pushed with, intent and all: that is the
    // screen being returned to, not a push.
    if (!navigation || navigation.trigger === 'popstate') return false;
    return intentOf(navigation.extras.state)?.stack === 'push';
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = keyOf(route);
    const kept = (this.handles.get(key) ?? []).filter(
      (handle) => !(handle as StoredHandle).componentRef?.hostView.destroyed,
    );
    if (kept.length) this.handles.set(key, kept);
    else this.handles.delete(key);
    // The newest: the one a back from the top of the stack returns to.
    return kept.at(-1) ?? null;
  }
}
