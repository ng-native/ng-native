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
import { inject } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  type NavigationExtras,
} from '@angular/router';
import { NativeBack } from './native-back.ts';
import type { ScreenPresentation, StackPresentation } from './screen-presentation.ts';

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
    return this.go(commands, extras, {
      stack: 'push',
      presentation: { stackPresentation: as, ...presentation },
    });
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
   * one. Resolves false, doing nothing, when no screen below the top of a stack in front is
   * showing that url; a push is the way to a screen that is not there.
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

    const navigate = () =>
      this.router.navigate(typeof commands === 'string' ? [pathOf(commands)] : [...commands], {
        ...extras,
        ...(typeof commands === 'string' ? this.queryOf(commands, extras) : {}),
        state: { ...(state as object), [NATIVE_INTENT]: full },
      });
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
    const path =
      typeof commands === 'string'
        ? pathOf(commands)
        : this.router.serializeUrl(this.router.createUrlTree([...commands], extras));
    const tab = this.outlets.unopenedTabOf(path.replace(/[?#].*$/, ''));
    if (!tab) return navigate();
    return this.router.navigateByUrl(tab).then((arrived) => (arrived ? navigate() : false));
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
