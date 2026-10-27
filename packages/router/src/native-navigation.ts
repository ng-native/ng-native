/**
 * The typed facade over `Router` for the intents a URL cannot express (ADR 0003).
 *
 * Angular's `Router` stays the single source of truth: each of these is a line over
 * `router.navigate`, setting `replaceUrl` and a presentation on `NavigationExtras.state`. Deep
 * links, guards and resolvers keep working because it is still the Router, and because state
 * rides in history a back restores the presentation the screen was opened with.
 *
 * A navigation service that owns the stack was rejected: it either re-implements guards,
 * resolvers and deep linking, or it drifts from the URL, and once the stack is not derived from
 * router state the two can disagree.
 *
 * No decorators, so tests can import it at runtime and so it can be provided with `useClass`,
 * exactly as `NativePlatformLocation` and `NativeStackReuseStrategy` are.
 */
import { DestroyRef, EnvironmentInjector, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  PRIMARY_OUTLET,
  Router,
  type Navigation,
  type NavigationExtras,
} from '@angular/router';
import { NativeBack } from './native-back.ts';
import type { ScreenPresentation, StackPresentation } from './screen-presentation.ts';
import { PRESENTED, leavingPresented, presentedCommands } from './presented-route.ts';
import { hasCommandKeyParameters, urlCommands, withWrittenParameters } from './url-commands.ts';

/** What `Router` takes: a url string, or the array form with segments and params. */
export type NavigationCommands = string | readonly unknown[];

/**
 * Where the intent rides. `NavigationExtras.state` is the app's own object, so ours sits under
 * one reserved key rather than spread through it.
 */
export const NATIVE_INTENT = 'ɵnativeStack';

/** What a navigation asks the outlet to do with the stack, over and above rendering the route. */
export interface NativeIntent {
  /** `replace` drops the screen it supersedes; `reset` empties the stack first. */
  readonly stack?: 'push' | 'replace' | 'reset';
  readonly presentation?: ScreenPresentation;
}

export interface NativeNavigationOptions extends NavigationExtras {
  /** How the screen arrives: presentation, animation, gesture and sheet props. */
  presentation?: ScreenPresentation;
}

export interface PresentOptions extends NativeNavigationOptions {
  /** Shorthand for `presentation.stackPresentation`. Defaults to `modal`. */
  as?: StackPresentation;
}

/** Whether commands ask for a query or a fragment, written into a url string or as extras. */
const asksMore = (commands: NavigationCommands, extras: NavigationExtras): boolean =>
  (typeof commands === 'string' && /[?#]/.test(commands)) ||
  extras.queryParams != null ||
  extras.fragment != null;

/** A url string's path, and the outlet whose segments it writes. */
interface WrittenPath {
  readonly path: string;
  readonly outlet: string;
}

/** A url string up to its query or fragment. */
const pathOf = (url: string): string => url.split(/[?#]/, 1)[0]!;

/**
 * A replace's or a reset's presentation, made to push its screen in with the `stackAnimation` it
 * names unless it names a `replaceAnimation` too. `RNSScreenStack` otherwise runs it as a pop of
 * the screen leaving, which animates as that screen says and never reads the one arriving.
 * `default` names no animation of its own, so it is left a pop, as no `stackAnimation` is.
 */
function arrivingAs(intent: NativeIntent, presentation: ScreenPresentation): ScreenPresentation {
  const replacing = intent.stack === 'replace' || intent.stack === 'reset';
  const named =
    presentation.stackAnimation !== undefined && presentation.stackAnimation !== 'default';
  if (!replacing || !named || presentation.replaceAnimation) return presentation;
  return { ...presentation, replaceAnimation: 'push' };
}

/** Read the intent off a navigation's state, if it carries one. */
export function intentOf(state: unknown): NativeIntent | null {
  if (!state || typeof state !== 'object') return null;
  const intent = (state as Record<string, unknown>)[NATIVE_INTENT];
  return intent && typeof intent === 'object' ? (intent as NativeIntent) : null;
}

/**
 * The intent of a navigation a guard redirected, for the navigation the redirect starts.
 *
 * The router starts a new navigation for a guard's `UrlTree`, keeping `replaceUrl` but not
 * `state`, so a reset to a page that sends a signed-out user to sign in would push the sign-in
 * page over the stack it was meant to clear. Held for that one navigation by its id, which no
 * later navigation shares.
 */
const redirected = new WeakMap<object, { readonly id: number; readonly intent: NativeIntent }>();

/** What a navigation asks of the stack: its own intent, or the one it was redirected from. */
export function navigationIntent(
  router: object,
  navigation: Pick<Navigation, 'id' | 'extras'> | null | undefined,
): NativeIntent | null {
  if (!navigation) return null;
  const own = intentOf(navigation.extras.state);
  if (own) return own;
  const carried = redirected.get(router);
  return carried?.id === navigation.id ? carried.intent : null;
}

/**
 * Hand a navigation's intent on to the one its guard redirects it to. The router schedules that
 * navigation as soon as it has reported the cancel, so it takes the next id.
 *
 * A reset that lands on the screen already on top, its own url or the one a redirect sends it to,
 * is one no outlet activates anything for: the router skips the url already showing, and reuses
 * the screen for another url of it. So the stack is reset here, to the screen on top.
 */
export function carryIntentAcrossRedirects(): void {
  const router = inject(Router);
  const outlets = inject(NativeBack);
  const events = router.events.subscribe((event) => {
    if (event instanceof NavigationCancel && event.code === NavigationCancellationCode.Redirect) {
      carryPast(router, event.id);
      return;
    }
    if (keptTop(event, outlets) && intentAt(router, event.id)?.stack === 'reset') {
      outlets.resetToTop();
    }
    if (ended(event) && redirected.get(router)?.id === event.id) redirected.delete(router);
  });
  inject(DestroyRef).onDestroy(() => events.unsubscribe());
}

/**
 * Whether the navigation `event` ends left the screen on top where it was: one the router skipped
 * for the url already showing, or one no stack put a screen on top for, such as a url with another
 * query, or one a redirect sends to the page on top.
 */
function keptTop(event: unknown, outlets: NativeBack): event is { readonly id: number } {
  if (event instanceof NavigationSkipped) {
    return event.code === NavigationSkippedCode.IgnoredSameUrlNavigation;
  }
  return event instanceof NavigationEnd && !outlets.stackedIn(event.id);
}

/** The intent of the navigation in progress, when it is the one with `id`. */
function intentAt(router: Router, id: number): NativeIntent | null {
  const navigation = router.currentNavigation();
  return navigation?.id === id ? navigationIntent(router, navigation) : null;
}

/** Hold the intent of the navigation a guard redirected for the one the redirect starts. */
function carryPast(router: Router, id: number): void {
  const intent = intentAt(router, id);
  if (intent) redirected.set(router, { id: id + 1, intent });
  else redirected.delete(router);
}

/** Whether the event is the last a navigation reports. */
function ended(event: unknown): event is { readonly id: number } {
  return (
    event instanceof NavigationEnd ||
    event instanceof NavigationCancel ||
    event instanceof NavigationError ||
    event instanceof NavigationSkipped
  );
}

export class NativeNavigation {
  private readonly router = inject(Router);
  // Absent only where the service is made outside an app, as a unit test makes it.
  private readonly injector = inject(EnvironmentInjector, { optional: true }) ?? undefined;
  private readonly outlets = inject(NativeBack);

  /**
   * Push a new screen onto the stack. The plain case, and what `nativeRouterLink` does.
   *
   * From a presented screen the new one is presented the same way, over it, since a pushed
   * screen would slide in under it; `presentation` says otherwise, `stackAnimation` and all.
   */
  push(commands: NavigationCommands, options: NativeNavigationOptions = {}): Promise<boolean> {
    return this.go(commands, options, { stack: 'push' });
  }

  /**
   * Swap the current screen for another. The history entry is replaced too, so a back from the
   * new screen goes where a back from the old one would have.
   *
   * A `stackAnimation` in `presentation` is the one the new screen arrives with. Without one, with
   * `default`, or with a `replaceAnimation`, the swap animates as the screen leaving was opened.
   */
  replace(commands: NavigationCommands, options: NativeNavigationOptions = {}): Promise<boolean> {
    return this.go(commands, { ...options, replaceUrl: true }, { stack: 'replace' });
  }

  /**
   * Present a screen over the stack rather than pushing into it: a modal, or a sheet.
   *
   * `present('/filters', { as: 'formSheet', presentation: { sheetAllowedDetents: [0.5, 1] } })`.
   *
   * A presented screen is put on screen outside the stack's navigation controller, so it has no
   * native header and no automatic safe-area insets: it needs its own way out, and its own
   * `safe-area-view`. A sheet can also be dragged away, but `fullScreenModal` cannot, and with
   * `gestureEnabled: false` neither can.
   *
   * On iOS, from a screen a tab's stack presents `fullScreenModal`, a screen for the app's own
   * stack cannot show, and this resolves false: see `refuse-screens-under-full-screen.ts`.
   */
  present(commands: NavigationCommands, options: PresentOptions = {}): Promise<boolean> {
    if (this.firstNavigationRunning()) {
      return this.firstNavigation().then(() => this.present(commands, options));
    }
    const { as = 'modal', presentation, ...extras } = options;
    const intent: NativeIntent = {
      stack: 'push',
      presentation: { stackPresentation: as, ...presentation },
    };
    // Asked at once, and only waited for when the page is another tab's: finding its route may
    // load a lazy one.
    const over = this.overTheTabInFront(commands, extras);
    if (!over) return this.go(commands, extras, intent);
    return over.then((found) =>
      found
        ? this.go(found.commands, found.extras, intent, found.written)
        : this.go(commands, extras, intent),
    );
  }

  /**
   * Replace the whole stack with one screen, the way signing out or finishing onboarding does.
   * Every screen below is destroyed, so there is nothing to go back to.
   *
   * A `stackAnimation` in `presentation` is the one a new screen arrives with:
   * `reset('/sign-in', { presentation: { stackAnimation: 'none' } })` lands with no animation.
   * Without one, with `default`, or with a `replaceAnimation`, the reset animates as the screen
   * leaving was opened, and so does a reset to a screen still on the stack, which is kept.
   */
  reset(commands: NavigationCommands, options: NativeNavigationOptions = {}): Promise<boolean> {
    return this.go(commands, { ...options, replaceUrl: true }, { stack: 'reset' });
  }

  /**
   * Go back exactly as the Android back button does: pop the stack in front, or at the root of a
   * tab's stack, go to the first tab. Not one entry back through history, which after a trip to
   * another tab is that tab. At the root of the app there is nowhere to go, and this does nothing.
   */
  back(): void {
    // Optional call: a test that stands a plain object in for the router has no such signal.
    if (!this.router.currentNavigation?.()) {
      this.outlets.back();
      return;
    }
    // Asked while a navigation is still putting its screen up: a page that leaves as it appears,
    // from an effect in its constructor. No stack has that screen to pop yet, so the back waits
    // for the navigation, and goes nowhere if the navigation does not arrive.
    if (this.backWaiting) return;
    this.backWaiting = this.router.events.subscribe((event) => {
      const ended = event instanceof NavigationEnd;
      if (!ended && !(event instanceof NavigationCancel) && !(event instanceof NavigationError)) {
        return;
      }
      this.backWaiting?.unsubscribe();
      this.backWaiting = null;
      if (ended) this.outlets.back();
    });
  }

  /** The wait of a back asked for mid-navigation, so two asked for in one are one. */
  private backWaiting: { unsubscribe(): void } | null = null;

  /**
   * Pop straight back to the screen at `commands`, taking every screen above it off the stack at
   * once - `popToViewController`. The screen is the one already there, with its state, not a new
   * one; where that url is also the one showing, the screen on top is the one kept. Resolves
   * false, doing nothing, when no screen below the top of a stack in front is showing that url; a
   * push is the way to a screen that is not there.
   */
  popTo(commands: NavigationCommands): Promise<boolean> {
    const tree =
      typeof commands === 'string'
        ? this.router.parseUrl(commands)
        : this.router.createUrlTree([...commands]);
    return this.outlets.popTo(this.router.serializeUrl(tree));
  }

  /**
   * Pop the stack in front to its first screen - `popToRootViewController`. Inside a tab, that is
   * the tab's first screen; the screens below keep their state. Resolves false at the root already.
   */
  popToRoot(): Promise<boolean> {
    return this.outlets.popToRoot();
  }

  private go(
    commands: NavigationCommands,
    options: NativeNavigationOptions,
    intent: NativeIntent,
    written: WrittenPath | null = typeof commands === 'string'
      ? { path: pathOf(commands), outlet: PRIMARY_OUTLET }
      : null,
  ): Promise<boolean> {
    const { presentation, state, ...extras } = options;
    const full: NativeIntent = presentation
      ? { ...intent, presentation: arrivingAs(intent, { ...intent.presentation, ...presentation }) }
      : intent;

    const navigate = () => {
      const list =
        typeof commands === 'string' ? urlCommands(this.router, pathOf(commands)) : [...commands];
      const all = {
        ...extras,
        ...(typeof commands === 'string' ? this.queryOf(commands, extras) : {}),
        state: { ...(state as object), [NATIVE_INTENT]: full },
      };
      const leaving = leavingPresented(this.router, list, all);
      // A parameter the commands could not carry goes back on the tree they make, which is what
      // `navigate` would go to; `navigateByUrl` then takes it as it is.
      if (written && hasCommandKeyParameters(this.router, written.path)) {
        const tree = leaving ?? this.router.createUrlTree(list, all);
        return this.router.navigateByUrl(
          withWrittenParameters(this.router, tree, written.path, written.outlet),
          all,
        );
      }
      return leaving ? this.router.navigateByUrl(leaving, all) : this.router.navigate(list, all);
    };
    // A screen stacked on the first one waits for it. Navigating while the router's first
    // navigation is still running - a lazily loaded root waiting on its import - cancels that
    // navigation, and the app opens on this screen with nothing beneath it. A reset replaces the
    // stack anyway, so it goes at once.
    const start = () => this.underTabRoot(commands, extras, full, navigate);
    return intent.stack !== 'reset' && this.firstNavigationRunning()
      ? this.firstNavigation().then(start)
      : start();
  }

  /**
   * A push to a page of a tab bar that a screen over it covers, pushed on the app's own stack or
   * presented, goes back to the bar first: to its tab, where that was left, and then pushes the
   * page there unless the tab is already showing it. One tab bar, as a native app has. Pushed as
   * it was asked, the page would build a second bar over the screen.
   *
   * A push into a tab nobody has opened goes to the tab first, so its stack has the tab's own
   * first screen under the page, and a back from the page lands there: what a tab bar with a
   * navigation controller per tab does. Without it the page is the stack's only screen, and the
   * same push leaves a different stack behind depending on whether the tab was ever tapped. A
   * presented screen goes where it is asked, and a replace or a reset has nothing to keep.
   */
  private underTabRoot(
    commands: NavigationCommands,
    extras: NavigationExtras,
    intent: NativeIntent,
    navigate: () => Promise<boolean>,
  ): Promise<boolean> {
    if (intent.stack !== 'push' || intent.presentation) return navigate();
    const path = this.pathFor(commands, extras);
    const left = this.outlets.coveredTabAt(path);
    if (left) {
      // The tab is open once the bar is back, so the page goes straight onto it, unless it is the
      // page the tab was left on and nothing more, a query or a fragment, is asked of it.
      const asked = pathOf(left) !== path || asksMore(commands, extras);
      // A guard that redirects elsewhere still resolves true, so the tab must be in front now.
      return this.router.navigateByUrl(left).then((arrived) => {
        const there =
          arrived && !this.outlets.coveredTabAt(path) && !this.outlets.inTabBehind(path);
        return there && asked ? navigate() : there;
      });
    }
    const tab = this.outlets.unopenedTabOf(path);
    if (!tab) return navigate();
    return this.router
      .navigateByUrl(tab)
      .then((arrived) => (arrived && !this.outlets.unopenedTabOf(path) ? navigate() : false));
  }

  /** The path the commands lead to, without its query and fragment. */
  private pathFor(commands: NavigationCommands, extras: NavigationExtras): string {
    if (typeof commands === 'string' && commands.startsWith('/')) return pathOf(commands);
    // Resolved as `go` navigates them: a relative string against `relativeTo`.
    const list =
      typeof commands === 'string' ? urlCommands(this.router, pathOf(commands)) : [...commands];
    return pathOf(this.router.serializeUrl(this.router.createUrlTree(list, extras)));
  }

  /**
   * A page of a tab that is not in front, presented over the one that is, or over a screen that
   * covers the bar: its url would select
   * its own tab and show it there, so it goes to the root's presented outlet instead, where the
   * app's own stack shows it over everything. See `presented-route.ts`. Null for a page of the
   * tab in front, or of no tab, which is presented where its url puts it.
   */
  private overTheTabInFront(
    commands: NavigationCommands,
    extras: NavigationExtras,
  ): Promise<{
    commands: unknown[];
    extras: NavigationExtras;
    written: WrittenPath;
  } | null> | null {
    if (!this.outlets.presents) return null;
    const path = this.pathFor(commands, extras);
    // A tab in front of a bar a screen covers is behind that screen just the same.
    if (!this.outlets.inTabBehind(path) && !this.outlets.coveredTabAt(path)) return null;
    const query = typeof commands === 'string' ? this.queryOf(commands, extras) : {};
    return presentedCommands(this.router, path, this.injector).then(
      (presented) =>
        presented && {
          commands: presented,
          extras: { ...extras, ...query, relativeTo: null },
          written: { path, outlet: PRESENTED },
        },
    );
  }

  /**
   * The query and fragment written into a url string, as the extras `navigate` takes them: it
   * reads a string command as one path segment, and would encode a `?` into it. Extras given
   * alongside win over the ones in the string.
   */
  private queryOf(url: string, extras: NavigationExtras): NavigationExtras {
    const cut = url.search(/[?#]/);
    if (cut < 0) return {};
    const { queryParams, fragment } = this.router.parseUrl(url.slice(cut));
    return {
      queryParams: { ...queryParams, ...extras.queryParams },
      fragment: extras.fragment ?? fragment ?? undefined,
    };
  }

  private firstNavigationRunning(): boolean {
    const router = this.router as Partial<Router>;
    return router.navigated === false && !!router.currentNavigation?.();
  }

  private firstNavigation(): Promise<void> {
    return new Promise((resolve) => {
      const events = this.router.events.subscribe((event) => {
        if (ended(event) && !carriesOn(event)) {
          events.unsubscribe();
          resolve();
        }
      });
    });
  }
}

/**
 * Whether a navigation ended only for another to take its place: a guard's redirect does, and so
 * does a newer navigation. Waiting for a navigation to end goes on past one of these, or what
 * starts next supersedes the redirect and opens with nothing beneath it, past the guard.
 */
export function carriesOn(event: unknown): boolean {
  return (
    event instanceof NavigationCancel &&
    (event.code === NavigationCancellationCode.Redirect ||
      event.code === NavigationCancellationCode.SupersededByNewNavigation)
  );
}
