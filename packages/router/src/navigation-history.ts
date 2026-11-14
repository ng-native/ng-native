/**
 * Back and forward history for each window, as a desktop browser or Finder keeps it: one list per
 * window, spanning every change of the window's outlet, sidebar items included. A new navigation
 * clears the entries ahead, and a window keeps its last 100, dropping the oldest. A page left behind is destroyed, so forward builds it again from its
 * URL, as a browser does without a back-forward cache: its scroll position and form state are not
 * kept. History is not restored on relaunch.
 *
 * Each window renders one outlet of the app's Router (the main window the primary one, a route
 * window its named one), so a window's history is its outlet's. The OS's back and forward inputs
 * arrive through `Menus.onNavigate` from `@ng-native/device`, with the window they were in.
 */
import { DestroyRef, Service, computed, inject, signal, type Signal } from '@angular/core';
import {
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  UrlSegmentGroup,
  UrlSerializer,
  UrlTree,
} from '@angular/router';
import { AppWindows, Menus, type MenuItemModel } from '@ng-native/device';

/** One window's history: the outlet's paths, oldest first, and which one is showing. */
export interface OutletHistory {
  readonly entries: Signal<readonly string[]>;
  readonly index: Signal<number>;
  readonly canGoBack: Signal<boolean>;
  readonly canGoForward: Signal<boolean>;
  /**
   * The entries behind and ahead as menu items, nearest first, for the list a long press on the
   * back or forward chevron shows.
   */
  readonly backMenu: Signal<readonly MenuItemModel[]>;
  readonly forwardMenu: Signal<readonly MenuItemModel[]>;
  /** Go one entry back. Resolves false where there is none, or the navigation did not happen. */
  back(): Promise<boolean>;
  /** Go one entry forward, building its page again from its URL. */
  forward(): Promise<boolean>;
  /** Go to the entry at `index`. */
  go(index: number): Promise<boolean>;
}

/** The path `outlet` shows in `tree`, as `/a/b`, or null where it shows nothing. */
function outletPath(tree: UrlTree, outlet: string, serializer: UrlSerializer): string | null {
  const group = tree.root.children[outlet];
  if (!group) return outlet === PRIMARY_OUTLET ? '/' : null;
  // Only the outlet's own segments and what is under them: the other windows are not its history.
  return serializer.serialize(
    new UrlTree(new UrlSegmentGroup([], { [PRIMARY_OUTLET]: group }), tree.queryParams),
  );
}

/** The entries a window keeps, as a browser's back list does: the oldest are dropped past it. */
const MAX_ENTRIES = 100;

class History implements OutletHistory {
  readonly entries = signal<readonly string[]>([]);
  readonly index = signal(-1);
  readonly canGoBack = computed(() => this.index() > 0);
  readonly canGoForward = computed(() => this.index() < this.entries().length - 1);
  readonly backMenu = computed(() => this.menu(-1));
  readonly forwardMenu = computed(() => this.menu(1));
  /** The entry a back or forward of ours is on its way to, which is not a new entry. */
  private pending: { path: string; index: number } | null = null;

  private readonly outlet: string;
  private readonly router: Router;

  constructor(outlet: string, router: Router) {
    this.outlet = outlet;
    this.router = router;
  }

  back(): Promise<boolean> {
    return this.go(this.index() - 1);
  }

  forward(): Promise<boolean> {
    return this.go(this.index() + 1);
  }

  async go(index: number): Promise<boolean> {
    const path = this.entries()[index];
    if (path === undefined || index === this.index()) return false;
    this.pending = { path, index };
    const tree = this.router.parseUrl(path);
    const group = tree.root.children[PRIMARY_OUTLET];
    const segments = group ? group.segments.map((segment) => segment.path) : [];
    const done = await this.router.navigate([{ outlets: { [this.outlet]: segments } }], {
      queryParams: tree.queryParams,
    });
    if (!done) this.pending = null;
    return done;
  }

  /** What a finished navigation leaves the outlet showing: `path`. */
  record(path: string): void {
    const pending = this.pending;
    this.pending = null;
    if (pending?.path === path) {
      this.index.set(pending.index);
      return;
    }
    if (this.entries()[this.index()] === path) return;
    const kept = [...this.entries().slice(0, this.index() + 1), path].slice(-MAX_ENTRIES);
    this.entries.set(kept);
    this.index.set(kept.length - 1);
  }

  private menu(step: -1 | 1): MenuItemModel[] {
    const items: MenuItemModel[] = [];
    const entries = this.entries();
    for (let at = this.index() + step; at >= 0 && at < entries.length; at += step) {
      items.push({ label: entries[at]!, select: () => void this.go(at) });
    }
    return items;
  }
}

@Service()
export class NavigationHistory {
  private readonly router = inject(Router);
  private readonly windows = inject(AppWindows);
  private readonly serializer = inject(UrlSerializer);
  private readonly histories = new Map<string, History>();

  constructor() {
    const events = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd)
        this.recordAll(this.router.parseUrl(event.urlAfterRedirects));
    });
    const contexts = inject(ChildrenOutletContexts);
    const stop = inject(Menus).onNavigate((direction, surface) => {
      const outlet = this.outletOf(surface);
      if (outlet === null) return;
      // A screen with `gestureEnabled: false` is left only by its own way out.
      const showing = contexts.getContext(outlet)?.outlet as { refusesGesture?(): boolean } | null;
      if (showing?.refusesGesture?.()) return;
      const history = this.for(outlet);
      void (direction === 'back' ? history.back() : history.forward());
    });
    inject(DestroyRef).onDestroy(() => {
      events.unsubscribe();
      stop();
    });
  }

  /** The history of the window rendering `outlet`: the main window's by default. */
  for(outlet: string = PRIMARY_OUTLET): OutletHistory {
    let history = this.histories.get(outlet);
    if (!history) this.histories.set(outlet, (history = new History(outlet, this.router)));
    return history;
  }

  /** The outlet of the window on `surface`; with none given, of the focused window. */
  private outletOf(surface: number | undefined): string | null {
    const window =
      surface === undefined
        ? this.windows.focused()
        : this.windows.windows().find((one) => one.surface === surface);
    if (!window) return surface === undefined ? PRIMARY_OUTLET : null;
    // A route window's key is its outlet; the main window's is `main`, the primary outlet's.
    if (window.key === 'main') return PRIMARY_OUTLET;
    return window.key && this.histories.has(window.key) ? window.key : null;
  }

  /**
   * Record where every outlet is after a navigation. An outlet that shows nothing now has had its
   * window closed, so its history goes with it; the primary outlet's stays.
   */
  private recordAll(tree: UrlTree): void {
    const outlets = new Set([PRIMARY_OUTLET, ...Object.keys(tree.root.children)]);
    for (const outlet of [...this.histories.keys(), ...outlets]) {
      const path = outletPath(tree, outlet, this.serializer);
      if (path === null) {
        if (outlet !== PRIMARY_OUTLET) this.histories.delete(outlet);
        continue;
      }
      (this.for(outlet) as History).record(path);
    }
  }
}
