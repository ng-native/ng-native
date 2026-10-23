/**
 * Who answers a back: Android's hardware button, and `NativeNavigation.back()`.
 *
 * Every outlet offers an answer, and the one in front takes it. Each answer is also handed to
 * `HardwareBack` directly, where React Native asks the newest first. An outlet always subscribes
 * after the outlet it sits inside, so that order runs from the innermost outlet out, and a
 * screen's own handler, subscribed after its outlet, still outranks it. `back()` asks the outlets
 * in that same order, without the screens' own handlers: those are for the button.
 *
 * Newest first is not enough on its own. A stack in a tab behind the one in front, or under a
 * screen pushed over the whole tab bar, is still subscribed, so each answer first checks that
 * its outlet is showing what the router is showing.
 */
import { DestroyRef, Service, inject } from '@angular/core';
import {
  ChildrenOutletContexts,
  NavigationError,
  NavigationStart,
  Router,
  type ActivatedRoute,
  type ActivatedRouteSnapshot,
  type UrlSegment,
} from '@angular/router';
import { HardwareBack } from '@ng-native/device';

/** What a stack offers `NativeNavigation` beyond a back: going down it several screens at once. */
export interface PoppableStack {
  /** Whether this stack is part of what the router shows now. */
  showing(): boolean;
  /** Pop to its first screen, or null when it is showing only that one. */
  popToRoot(): Promise<boolean> | null;
  /** Pop to the screen showing `url`, or null when no screen below the top shows it. */
  popTo(url: string): Promise<boolean> | null;
  /** Take every screen under the top off at once, or false when it is showing only that one. */
  dropUnderTop(): boolean;
}

/**
 * What a tab bar offers `NativeNavigation` for a push into one of its tabs from outside it. A tab
 * nobody has opened has no stack yet, and a page pushed into it would be the stack's first
 * screen, with nothing under it to go back to.
 */
export interface TabBar {
  /** The url of the tab `url` is a page inside, when that tab has not been opened. */
  unopenedTabOf(url: string): string | null;
  /** Whether `url` is a tab other than the one in front, or a page inside one. */
  behind(url: string): boolean;
  /**
   * Where the tab `url` is in was left, when a screen of the stack the bar is on covers the bar:
   * the url that brings the bar back in front at that tab. Null when the bar is in front, or
   * `url` is in none of its tabs.
   */
  coveredAt(url: string): string | null;
}

@Service()
export class NativeBack {
  private readonly hardwareBack = inject(HardwareBack);
  /** Oldest first, as `HardwareBack` holds them. */
  private readonly answers: BackAnswer[] = [];
  /** Oldest first, and so outermost first, as the answers are. */
  private readonly stacks: PoppableStack[] = [];

  /** Oldest first. */
  private readonly tabBars: TabBar[] = [];

  /** Offer a tab bar's unopened tabs to a push into one. Returns an unsubscribe. */
  addTabBar(bar: TabBar): () => void {
    this.tabBars.push(bar);
    return () => {
      const index = this.tabBars.indexOf(bar);
      if (index !== -1) this.tabBars.splice(index, 1);
    };
  }

  /** The url of the unopened tab `url` is a page inside, or null: see `TabBar`. */
  unopenedTabOf(url: string): string | null {
    for (const bar of this.tabBars) {
      const root = bar.unopenedTabOf(url);
      if (root) return root;
    }
    return null;
  }

  /** Where a covered bar's tab holding `url` was left, or null: see `TabBar.coveredAt`. */
  coveredTabAt(url: string): string | null {
    for (const bar of this.tabBars) {
      const at = bar.coveredAt(url);
      if (at) return at;
    }
    return null;
  }

  /** Whether `url` belongs to a tab that is not the one in front. */
  inTabBehind(url: string): boolean {
    return this.tabBars.some((bar) => bar.behind(url));
  }

  /**
   * Whether the app's own stack takes a page presented over whatever is showing. Set by the root
   * stack outlet for as long as there is one: see `presented-route.ts`.
   */
  presents = false;

  /** Offer a stack for popping several screens at once. Returns an unsubscribe. */
  addStack(stack: PoppableStack): () => void {
    this.stacks.push(stack);
    return () => {
      const index = this.stacks.indexOf(stack);
      if (index !== -1) this.stacks.splice(index, 1);
    };
  }

  /** Pop the innermost stack in front that is deeper than one screen, to its first. */
  popToRoot(): Promise<boolean> {
    for (const stack of [...this.stacks].reverse()) {
      if (!stack.showing()) continue;
      const popped = stack.popToRoot();
      if (popped) return popped;
    }
    return Promise.resolve(false);
  }

  /**
   * Take the screens under the top of the innermost stack in front that has any off it, leaving
   * the top one: a reset that lands on the screen already on top, which no stack activates
   * anything for. False when no stack in front had any.
   */
  resetToTop(): boolean {
    return [...this.stacks].reverse().some((stack) => stack.showing() && stack.dropUnderTop());
  }

  /** The id of the last navigation a stack put a screen on top for. */
  private lastStacked: number | undefined;

  /** A stack put a screen on top, a new one or one it kept, for the navigation with that id. */
  stacked(navigation: number | undefined): void {
    if (navigation !== undefined) this.lastStacked = navigation;
  }

  /**
   * Whether a stack put a screen on top for the navigation with that id. One that put none left
   * the screen on top where it was, as a navigation to it with another query does.
   */
  stackedIn(navigation: number): boolean {
    return this.lastStacked === navigation;
  }

  /** Pop the innermost stack in front that has a screen at `url` below its top, down to it. */
  popTo(url: string): Promise<boolean> {
    for (const stack of [...this.stacks].reverse()) {
      if (!stack.showing()) continue;
      const popped = stack.popTo(url);
      if (popped) return popped;
    }
    return Promise.resolve(false);
  }

  /**
   * Offer an outlet's answer to a back. It returns whether it took the back, and false lets the
   * next one out try. Returns an unsubscribe.
   */
  handle(answer: BackAnswer): () => void {
    this.answers.push(answer);
    const stop = this.hardwareBack.handle(() => answer('button'));
    return () => {
      stop();
      const index = this.answers.indexOf(answer);
      if (index !== -1) this.answers.splice(index, 1);
    };
  }

  /** Go back as the button would, innermost outlet first. False when none had anywhere to go. */
  back(): boolean {
    return [...this.answers].reverse().some((answer) => answer('app'));
  }
}

/**
 * An outlet's answer to a back, told where it came from: Android's button, which is the platform's
 * own dismissal and a screen may refuse, or the app's `NativeNavigation.back()`, which it may not.
 */
export type BackAnswer = (from: 'button' | 'app') => boolean;

/**
 * Whether a route is part of what the router shows now, rather than a subtree the reuse strategy
 * detached and is keeping for later: a tab behind, or a screen covered by one pushed over it.
 *
 * Read from the snapshots: the root route is the same object in every state, and after a failed
 * navigation its children are still the ones that navigation would have shown.
 */
export function isShowing(router: Router, route: ActivatedRoute | null): boolean {
  if (!route) return false;
  const showing = route.snapshot;
  const visit = (node: ActivatedRouteSnapshot): boolean =>
    node === showing || node.children.some(visit);
  return visit(router.routerState.snapshot.root);
}

/**
 * Put back the snapshots of the routes showing when a navigation fails, for `isShowing`.
 *
 * The router moves each route it keeps, such as the parent of a page that throws, on to the
 * navigation's snapshot as it activates it, and on a failure puts back only its own state. That
 * route would then be missing from the snapshots, and its outlet would ignore a Back.
 */
export function restoreFailedSnapshots(): void {
  const router = inject(Router);
  const contexts = inject(ChildrenOutletContexts);
  let showing = new Map<ActivatedRoute, ActivatedRouteSnapshot>();
  const events = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) showing = showingRoutes(router, contexts);
    else if (event instanceof NavigationError) {
      for (const [route, snapshot] of showing) restoreSnapshot(route, snapshot);
    }
  });
  inject(DestroyRef).onDestroy(() => events.unsubscribe());
}

/**
 * Put back the snapshot a failed navigation moved `route` on from, and send what that move changed
 * back through the route's observables, as the router sends a change: a page reading its query
 * params, or bound to them as inputs, sees the values it had again.
 *
 * The router's observables for a route are the subjects it sends each change through, though it
 * types them as plain observables. One that cannot be sent to is left as it is.
 */
export function restoreSnapshot(route: ActivatedRoute, snapshot: ActivatedRouteSnapshot): void {
  const failed = route.snapshot;
  route.snapshot = snapshot;
  if (failed === snapshot) return;
  const resend = <T>(observable: object, from: T, to: T, same: (a: T, b: T) => boolean) => {
    if (!same(from, to)) (observable as { next?: (value: T) => void }).next?.(to);
  };
  resend(route.queryParams, failed.queryParams, snapshot.queryParams, sameRecord);
  resend(route.fragment, failed.fragment, snapshot.fragment, Object.is);
  resend(route.params, failed.params, snapshot.params, sameRecord);
  resend(route.url, failed.url, snapshot.url, sameSegments);
  resend(route.data, failed.data, snapshot.data, sameRecord);
}

/** Whether two records hold the same values, an array of values compared item by item. */
function sameRecord(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const [x, y] = [a[key], b[key]];
    if (Array.isArray(x) && Array.isArray(y)) {
      return x.length === y.length && x.every((item, index) => item === y[index]);
    }
    return key in b && x === y;
  });
}

function sameSegments(a: readonly UrlSegment[], b: readonly UrlSegment[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (segment, index) =>
        segment.path === b[index]!.path && sameRecord(segment.parameters, b[index]!.parameters),
    )
  );
}

/**
 * Each route the router shows now, with its snapshot, found through the outlets showing them.
 *
 * A route with no component, a `loadChildren` wrapper or a group, has no outlet of its own: the
 * router activates its children in its parent's outlets, so they are looked up there.
 */
function showingRoutes(
  router: Router,
  contexts: ChildrenOutletContexts,
): Map<ActivatedRoute, ActivatedRouteSnapshot> {
  const state = router.routerState;
  const found = new Map([[state.root, state.snapshot.root]]);
  const visit = (node: ActivatedRouteSnapshot, inside: ChildrenOutletContexts) => {
    for (const child of node.children) {
      if (!child.component) {
        visit(child, inside);
        continue;
      }
      const context = inside.getContext(child.outlet);
      if (!context?.route) continue;
      found.set(context.route, child);
      visit(child, context.children);
    }
  };
  visit(state.snapshot.root, contexts);
  return found;
}
