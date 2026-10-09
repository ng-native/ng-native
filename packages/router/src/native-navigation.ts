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
import { DestroyRef, inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  Router,
  type Navigation,
  type NavigationExtras,
} from '@angular/router';
import { NativeBack } from './native-back.ts';
import type { ScreenPresentation, StackPresentation } from './screen-presentation.ts';
import { leavingPresented, presentedCommands } from './presented-route.ts';

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

/** A url string up to its query or fragment. */
const pathOf = (url: string): string => url.split(/[?#]/, 1)[0]!;

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
   */
  replace(commands: NavigationCommands, options: NavigationExtras = {}): Promise<boolean> {
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
   */
  present(commands: NavigationCommands, options: PresentOptions = {}): Promise<boolean> {
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
      this.go(found?.commands ?? commands, found?.extras ?? extras, intent),
    );
  }

  /**
   * Replace the whole stack with one screen, the way signing out or finishing onboarding does.
   * Every screen below is destroyed, so there is nothing to go back to.
   */
  reset(commands: NavigationCommands, options: NavigationExtras = {}): Promise<boolean> {
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
  ): Promise<boolean> {
    const { presentation, state, ...extras } = options;
    const full: NativeIntent = presentation
      ? { ...intent, presentation: { ...intent.presentation, ...presentation } }
      : intent;

    const navigate = () => {
      const list = typeof commands === 'string' ? [pathOf(commands)] : [...commands];
      const all = {
        ...extras,
        ...(typeof commands === 'string' ? this.queryOf(commands, extras) : {}),
        state: { ...(state as object), [NATIVE_INTENT]: full },
      };
      const leaving = leavingPresented(this.router, list, all);
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
    const tab = this.outlets.unopenedTabOf(this.pathFor(commands, extras));
    if (!tab) return navigate();
    return this.router.navigateByUrl(tab).then((arrived) => (arrived ? navigate() : false));
  }

  /** The path the commands lead to, without its query and fragment. */
  private pathFor(commands: NavigationCommands, extras: NavigationExtras): string {
    const url =
      typeof commands === 'string'
        ? commands
        : this.router.serializeUrl(this.router.createUrlTree([...commands], extras));
    return pathOf(url);
  }

  /**
   * A page of a tab that is not in front, presented over the one that is: its url would select
   * its own tab and show it there, so it goes to the root's presented outlet instead, where the
   * app's own stack shows it over everything. See `presented-route.ts`. Null for a page of the
   * tab in front, or of no tab, which is presented where its url puts it.
   */
  private overTheTabInFront(
    commands: NavigationCommands,
    extras: NavigationExtras,
  ): Promise<{ commands: unknown[]; extras: NavigationExtras } | null> | null {
    if (!this.outlets.presents) return null;
    const path = this.pathFor(commands, extras);
    if (!this.outlets.inTabBehind(path)) return null;
    const query = typeof commands === 'string' ? this.queryOf(commands, extras) : {};
    return presentedCommands(this.router, path).then(
      (presented) =>
        presented && { commands: presented, extras: { ...extras, ...query, relativeTo: null } },
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
        if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          events.unsubscribe();
          resolve();
        }
      });
    });
  }
}
