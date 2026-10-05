/**
 * A `RouterOutlet` that renders a native tab bar: a `UITabBarController` on iOS, a bottom
 * navigation bar on Android.
 *
 * The outlet's host element *is* the tabs host, and each `<native-tab>` in its content is one
 * item and the screen behind it. An activated route's component is created on a child view of
 * the matching tab screen. The screen belongs to the tab declaration and must survive the route
 * component being destroyed; Angular removes a component's host node when it destroys the ref.
 *
 * ```html
 * <native-tabs-outlet>
 *   <native-tab path="library" title="Library" sfSymbol="books.vertical.fill" />
 *   <native-tab path="inbox" title="Inbox" sfSymbol="tray" [badge]="unread()" />
 * </native-tabs-outlet>
 * ```
 *
 * **Native holds the selection, not us.** The tabs host owns its navigation state and reports
 * every change - a tap, or one we asked for - through `tabSelected`, carrying a `provenance`
 * number that increments per change. We send `navStateRequest` with the provenance of the last
 * state we acknowledged, which is how native tells a stale request from a current one when a tap
 * and a navigation cross in flight. The alternative, holding the selection in JS, means a tap is
 * only reflected after a round trip, and the bar lags the finger. See ADR 0006.
 *
 * **Each tab keeps its own screen mounted**, so switching away and back finds a tab exactly as it
 * was: its scroll offset, its text, and its own stack if it has one. That is the reuse strategy
 * detaching the tab's whole subtree rather than only its leaf.
 */
import {
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  ErrorHandler,
  Injector,
  Renderer2,
  computed,
  contentChildren,
  createComponent,
  inject,
  input,
  signal,
  type AfterContentInit,
  type ComponentRef,
  type EnvironmentInjector,
  type Type,
  type WritableSignal,
} from '@angular/core';
import { SCREEN_IN_FRONT } from '@ng-native/device';
import {
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  type Data,
  type Route,
  type RouterOutletContract,
} from '@angular/router';
import { bindRouteInputs } from './bind-route-inputs.ts';
import { NATIVE_TAB_DEFAULTS } from './native-bar-defaults.ts';
import { NativeBack, isShowing } from './native-back.ts';
import { optionalBoolean } from './transforms.ts';
import { NativeTab, screenKeyOf } from './native-tab.ts';
import { ownHost } from './own-host.ts';
import { markTabRoute } from './tab-routes.ts';
import { IN_TAB, type InTab } from './in-tab.ts';
import { taken, withoutPresented } from './presented-route.ts';

/** A url without its query or fragment. */
const pathOnly = (url: string): string => url.split(/[?#]/, 1)[0]!;

/**
 * Whether one of `routes` matches `segments`, whole or up to lazy children not loaded yet, which a
 * route that took a static segment of its own is taken to lead to. A parameter alone is not: it
 * takes any segment, pages outside the bar included, and its children may match none of the rest.
 */
function reaches(routes: readonly Route[], segments: readonly string[]): boolean {
  return routes.some((route) => {
    const count = taken(route, segments);
    if (count === null) return false;
    const rest = segments.slice(count);
    if (rest.length === 0) return true;
    if (route.children) return reaches(route.children, rest);
    const named = route.path!.split('/').some((part) => part && !part.startsWith(':'));
    return named && route.loadChildren !== undefined;
  });
}

interface TabEntry {
  readonly tab: NativeTab;
  /** The key native identifies this tab by: its path, unique among the bar's items. */
  readonly key: string;
  /** The url this tab was last on, so returning to it returns where the user left. */
  url: string;
  ref: ComponentRef<unknown> | null;
  route: ActivatedRoute | null;
  detached: boolean;
  /** Stops feeding route params into the component's inputs. */
  unbind: () => void;
  /** Whether this tab is the one showing, for what its screens hold: see `SCREEN_IN_FRONT`. */
  readonly inFront: WritableSignal<boolean>;
  /** What the tab's stacks dismiss when another tab comes in front: see `IN_TAB`. */
  readonly leaving: Set<() => string | null>;
}

/** What `tabSelected` carries. Only two fields matter here; the rest is diagnostics. */
interface TabSelection {
  readonly selectedScreenKey: string;
  readonly provenance: number;
}

@Component({
  selector: 'native-tabs-outlet',
  template: '<ng-content />',
  host: {
    '[style]': 'fill',
    '[tabBarHidden]': 'barHidden()',
    '[tabBarTintColor]': 'tintColor() ?? defaults().tintColor',
    '[nativeContainerBackgroundColor]': 'backgroundColor() ?? defaults().backgroundColor',
    '[colorScheme]': 'colorScheme() ?? defaults().colorScheme',
    '[tabBarMinimizeBehavior]': 'minimizeBehavior()',
    '[tabBarControllerMode]': 'controllerMode()',
    '[tabBarRespectsIMEInsets]': 'respectsKeyboard()',
  },
})
export class NativeTabsOutlet implements RouterOutletContract, AfterContentInit {
  name = PRIMARY_OUTLET;

  readonly supportsBindingToComponentInputs = true;

  private readonly parentContexts = inject(ChildrenOutletContexts);
  private readonly renderer = inject(Renderer2);
  private readonly applicationRef = inject(ApplicationRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef);
  private readonly route = inject(ActivatedRoute);
  /** Optional so the outlet can be driven through `RouterOutletContract` directly, as tests do. */
  private readonly router = inject(Router, { optional: true });
  private readonly errors = inject(ErrorHandler);
  /** What activation has reported already, so the failed navigation it causes is not reported again. */
  private readonly reported = new WeakSet<object>();
  /** The app's `withTabDefaults`, for whatever the outlet does not bind itself. */
  protected readonly defaults = inject(NATIVE_TAB_DEFAULTS);

  private readonly declared = contentChildren(NativeTab);
  private readonly entries: TabEntry[] = [];
  private selected: TabEntry | null = null;
  /** The provenance of the last state native told us about. Starts before native's first. */
  private provenance = 0;

  protected readonly fill = { flex: 1 };

  // --- the bar itself -----------------------------------------------------

  /** Hide the bar without unmounting the tabs, for a screen that wants the whole window. */
  readonly barHidden = input(undefined, { transform: optionalBoolean });
  /** The colour of the selected item. iOS. */
  readonly tintColor = input<string | number>();
  /** Behind the tabs, where a screen does not paint. */
  readonly backgroundColor = input<string | number>();
  /** Force the bar's light or dark appearance, whatever the app's is. */
  readonly colorScheme = input<'inherit' | 'light' | 'dark'>();
  /** iOS 26: let the bar shrink out of the way as content scrolls. */
  readonly minimizeBehavior = input<'automatic' | 'never' | 'onScrollDown' | 'onScrollUp'>();
  /** iOS: `tabSidebar` is the iPad layout, with the tabs down the side. */
  readonly controllerMode = input<'automatic' | 'tabBar' | 'tabSidebar'>();
  /** Android: keep the bar above the keyboard rather than behind it. */
  readonly respectsKeyboard = input(undefined, { transform: optionalBoolean });

  constructor() {
    ownHost(this.host.nativeElement);
    // In the constructor rather than a lifecycle hook: the router activates a child route as soon
    // as this component exists, which is before any hook has run.
    this.parentContexts.onChildOutletCreated(this.name, this);

    this.renderer.listen(
      this.host.nativeElement,
      'tabSelected',
      (event: { nativeEvent?: TabSelection }) => this.onNativeSelect(event?.nativeEvent),
    );

    // A push inside a tab's own stack reuses the tab's route, so this outlet is never activated
    // for it; the router's navigation is the only sign. Without this, coming back to the tab
    // returns it to its root and pops the screens the user left it on.
    const following = this.router?.events?.subscribe((event) => {
      // Without a page presented over the bar, which is no part of where the tab is.
      if (event instanceof NavigationEnd) {
        this.follow(withoutPresented(this.router!, event.urlAfterRedirects));
      }
    });

    // Android's back button, and `NativeNavigation.back()`, once the stack in front, if the tab
    // has one, is at its root. Subscribed before any tab's own stack, so it is asked after them.
    const back = inject(NativeBack);
    const unsubscribeBack = back.handle(() => this.goBack());
    const unsubscribeBar = back.addTabBar({
      unopenedTabOf: (url) => this.unopenedTabOf(url),
      behind: (url) => this.behind(url),
    });

    inject(DestroyRef).onDestroy(() => {
      unsubscribeBack();
      unsubscribeBar();
      following?.unsubscribe();
      for (const entry of this.entries) {
        entry.unbind();
        entry.ref?.destroy();
      }
      this.entries.length = 0;
      this.parentContexts.onChildOutletDestroyed(this.name);
    });
  }

  /** A bar nobody has navigated into yet still has to show a selected item. */
  ngAfterContentInit(): void {
    this.readTabs();
    this.activateCurrentRoute();
  }

  /**
   * The route the router is already on, for an outlet created after the navigation that reached
   * it, as `NativeStackOutlet` takes its own: a tab bar held behind a condition until a session
   * is ready. Once the tabs are read, since activating one needs to know which they are.
   */
  private activateCurrentRoute(): void {
    if (this.isActivated) return;
    const context = this.parentContexts.getContext(this.name);
    if (!context?.route) return;
    if (context.attachRef) this.attach(context.attachRef, context.route);
    else this.activateWith(context.route, context.injector);
  }

  /** The tabs in the bar, in template order. Exposed for tests. */
  get tabKeys(): string[] {
    return this.readTabs().map((entry) => entry.key);
  }

  /** Which tab native is showing. Exposed for tests. */
  get selectedKey(): string | null {
    return this.selected?.key ?? null;
  }

  // --- RouterOutletContract ----------------------------------------------

  get isActivated(): boolean {
    return this.selected?.ref != null && !this.selected.detached;
  }

  get component(): Object | null {
    return this.isActivated ? (this.selected!.ref!.instance as Object) : null;
  }

  get activatedRoute(): ActivatedRoute | null {
    return this.isActivated ? this.selected!.route : null;
  }

  get activatedRouteData(): Data {
    return this.activatedRoute?.snapshot.data ?? {};
  }

  /** The input binder reads this to bind route params to component inputs. */
  get activatedComponentRef(): ComponentRef<unknown> | null {
    return this.selected?.ref ?? null;
  }

  activateWith(route: ActivatedRoute, environmentInjector: EnvironmentInjector): void {
    const component = (route.component ?? route.snapshot.component) as Type<unknown> | null;
    if (!component) {
      throw new Error('[angular-native] route has no component to activate');
    }
    const entry = this.entryFor(route);

    // The tab screen is owned by <native-tab>, not by this route component. If the route uses
    // deactivate() rather than detach(), Angular removes the component host on destroy. Giving
    // the component its own child host keeps that removal from taking the tab bar item with it.
    const content = ownHost(this.renderer.createElement('view'));
    this.renderer.setStyle(content, 'flex', 1);
    this.renderer.appendChild(entry.tab.screen, content);

    let ref: ComponentRef<unknown> | undefined;
    try {
      ref = createComponent(component, {
        environmentInjector,
        elementInjector: this.outletInjector(route, entry),
        hostElement: content as Element,
      });
      this.applicationRef.attachView(ref.hostView);
      // Route params onto inputs before the first change detection, as the stack outlet does: a
      // required input still unset when the page first renders throws NG0950.
      entry.unbind = this.bindInputs(ref, route);
      // Before anything can commit. Creating the page's nodes dirties the tree, which schedules a
      // commit of its own - and that commit would capture the page with its elements created and
      // its bindings not yet applied. On iOS the props catch up a frame later and nobody sees it;
      // on Android the flattening decision is made from the props a view is created with, so a
      // content wrapper that arrives without its `collapsable: false` is flattened for good and
      // its children end up parented to a scroll view that allows exactly one.
      ref.changeDetectorRef.detectChanges();
    } catch (error) {
      this.abandon(entry, ref, content);
      this.errors.handleError(error);
      if (error !== null && typeof error === 'object') this.reported.add(error);
      throw error;
    }

    entry.ref = ref;
    entry.route = route;
    entry.detached = false;
    this.select(entry);
  }

  /**
   * Destroy the tab page in front: nothing once the router has detached it, as Angular's own
   * outlet does nothing then. A tab under a route with no component of its own, a `loadChildren`
   * wrapper or a group, has the router detach the page and then deactivate this same outlet, and
   * that page is the tab, kept for when it is selected again.
   */
  deactivate(): void {
    if (!this.isActivated) return;
    const entry = this.selected!;
    entry.unbind();
    entry.unbind = () => {};
    entry.ref!.destroy();
    entry.ref = null;
    entry.route = null;
  }

  /**
   * Hand the live `ComponentRef` back to the router. The tab's screen stays where it is with the
   * component still inside it, so the tab keeps running while another one is in front.
   */
  detach(): ComponentRef<unknown> {
    const entry = this.selected;
    if (!entry?.ref) throw new Error('[angular-native] outlet is not activated, nothing to detach');
    entry.detached = true;
    entry.inFront.set(false);
    // As in the stack outlet: stop change detection without unmounting the views.
    entry.ref.hostView.detach();
    return entry.ref;
  }

  attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void {
    const entry = this.entryFor(route);

    // A ref from a previous instance of this outlet still lives on its old tab screen, which is
    // gone; re-parent it onto this one's rather than rebuild the tab.
    if (entry.ref !== ref) {
      this.renderer.appendChild(entry.tab.screen, ref.location.nativeElement);
      this.applicationRef.attachView(ref.hostView);
      entry.ref = ref;
    }

    entry.route = route;
    entry.detached = false;
    // The route object is new even when the url is not, so the inputs follow the new one.
    entry.unbind();
    entry.unbind = this.bindInputs(ref, route);
    ref.hostView.reattach();
    this.select(entry);
  }

  // --- native tabs --------------------------------------------------------

  /**
   * Undo a tab page that threw on its first render, which fails the navigation: its component
   * and its content view go, and the tab that was showing carries on, change detection and all.
   */
  private abandon(entry: TabEntry, ref: ComponentRef<unknown> | undefined, content: unknown): void {
    entry.unbind();
    entry.unbind = () => {};
    ref?.destroy();
    this.renderer.removeChild(entry.tab.screen, content);
    const showing = this.selected;
    if (showing?.detached && showing.ref) {
      showing.detached = false;
      showing.ref.hostView.reattach();
    }
  }

  /** Route params onto inputs only under `withComponentInputBinding()`, as in the stack outlet. */
  private bindInputs(ref: ComponentRef<unknown>, route: ActivatedRoute): () => void {
    return this.router?.componentInputBindingEnabled ? bindRouteInputs(ref, route) : () => {};
  }

  /**
   * Take the bar from the `<native-tab>` elements in the content, once.
   *
   * On demand rather than in a lifecycle hook, because the router activates a child route during
   * this component's creation, before any hook has run - but after the content nodes themselves
   * exist, which is all this needs.
   */
  private readTabs(): TabEntry[] {
    if (this.entries.length > 0) return this.entries;

    const children = this.route.routeConfig?.children ?? [];
    for (const tab of this.declared()) {
      const key = tab.path();
      this.entries.push({
        tab,
        key,
        url: '',
        ref: null,
        route: null,
        detached: false,
        unbind: () => {},
        inFront: signal(false),
        leaving: new Set(),
      });
      // The reuse strategy detaches a tab whole, and has only the route to go on.
      // A path can have multiple route configs selected by canMatch (for example an iPad split
      // layout and an iPhone stack). Mark every variant: the reuse strategy sees the config
      // Angular actually matched, which may not be the first one in the route array.
      for (const config of children) {
        if (config.path === key) markTabRoute(config);
      }
    }

    if (this.entries.length === 0) {
      throw new Error(
        '[angular-native] <native-tabs-outlet> has no tabs. Put a <native-tab path="..."> ' +
          'inside it for each child route the bar should reach.',
      );
    }
    // Before the first navigation nothing is selected, which is not a state a tab bar has.
    this.request(this.entries[0]!);
    return this.entries;
  }

  /**
   * The tab `route` is the page of, by its path from this outlet's route down to it. A route with
   * no component above the page is part of that path: a `loadChildren` wrapper takes the tab's
   * path and leaves `''` to the page under it, and a group is a `''` of its own.
   */
  private entryFor(route: ActivatedRoute): TabEntry {
    const config = route.routeConfig ?? route.snapshot.routeConfig;
    const paths = [config?.path];
    for (let above = route.parent; above && !above.component; above = above.parent) {
      paths.unshift(above.routeConfig?.path);
    }
    const path = paths.filter(Boolean).join('/');
    const entry = this.readTabs().find((candidate) => candidate.key === path);
    if (!entry) {
      throw new Error(
        `[angular-native] no <native-tab> has path="${path}". Every child route the bar can ` +
          `reach needs one, and its path is what native identifies the tab by.`,
      );
    }
    // Under a wrapper the page's config is not one of the children `readTabs` marked, and it is
    // the one the reuse strategy is asked to detach whole.
    if (config) markTabRoute(config);
    return entry;
  }

  /** Remember where this tab is, and tell native to show it. */
  private select(entry: TabEntry): void {
    const left = this.selected;
    if (left && left !== entry) this.leave(left);
    this.selected = entry;
    for (const other of this.entries) other.inFront.set(other === entry);
    entry.url = this.router?.url ?? entry.url;
    this.request(entry);
  }

  /**
   * Another tab came in front of `entry`: its stacks dismiss what they presented, and it is
   * remembered at the page beneath, where the outermost stack that dismissed something is left.
   */
  private leave(entry: TabEntry): void {
    let url: string | null = null;
    for (const dismiss of entry.leaving) {
      const beneath = dismiss();
      url ??= beneath;
    }
    if (url !== null) entry.url = url;
  }

  /**
   * A back with nothing left to pop inside the tab: go to the first tab, where it was left, which
   * is what a bottom navigation bar does on Android. From the first tab, decline, so the platform
   * leaves the app. The order tabs were visited in is not retraced, so a back never lands on a
   * tab the user did not expect. Not while the bar is covered by a screen pushed over it: that
   * screen's stack answers instead.
   */
  private goBack(): boolean {
    const first = this.entries[0];
    const selected = this.selected;
    if (!first || !selected || selected === first || !this.router) return false;
    if (!this.isActivated || !isShowing(this.router, selected.route)) return false;
    void this.router.navigateByUrl(first.url || this.pathOf(first));
    return true;
  }

  /** Keep the tab in front on the url it has reached, as long as the url is still inside it. */
  private follow(url: string): void {
    const entry = this.selected;
    if (entry && this.tabOf(url) === entry) entry.url = url;
  }

  /**
   * The url of the tab `url` is a page inside, when nothing has opened that tab: the tab's own
   * first screen, which a push into the tab from outside it shows first.
   */
  private unopenedTabOf(url: string): string | null {
    const entry = this.tabOf(url);
    if (!entry || entry.ref) return null;
    const root = this.pathOf(entry);
    return pathOnly(url) === root ? null : root;
  }

  /** Whether `url` is a tab other than the one in front, or a page inside one. */
  private behind(url: string): boolean {
    const entry = this.tabOf(url);
    return entry !== null && entry !== this.selected;
  }

  /**
   * The tab `url` is in: the one with the longest url that starts it. A tab at `''` has the bar's
   * own url, which at the root starts every url, pages outside the bar included, so it takes only
   * a url its routes lead to, as far as they are loaded. A wildcard or a custom matcher is not
   * followed, as `taken` follows neither: a page only one of them shows is in no tab.
   */
  private tabOf(url: string): TabEntry | null {
    const path = pathOnly(url);
    let found: TabEntry | null = null;
    for (const entry of this.entries) {
      const root = this.pathOf(entry);
      const inside = path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
      if (!inside || (found && this.pathOf(found).length >= root.length)) continue;
      if (!entry.key && !this.leadsInto(entry, path.slice(root.length))) continue;
      found = entry;
    }
    return found;
  }

  /** Whether the routes of the tab at `''` lead to `rest`, the path under the bar's own url. */
  private leadsInto(entry: TabEntry, rest: string): boolean {
    const segments = rest.split('/').filter(Boolean);
    const own = entry.route?.snapshot.routeConfig;
    const routes = own
      ? [own]
      : (this.route.routeConfig?.children ?? []).filter((config) => config.path === '');
    return segments.length === 0 || reaches(routes, segments);
  }

  private request(entry: TabEntry): void {
    this.renderer.setProperty(this.host.nativeElement, 'navStateRequest', {
      selectedScreenKey: screenKeyOf(entry.key),
      baseProvenance: this.provenance,
    });
  }

  /**
   * Native switched tab. Acknowledge the new state, then navigate: the router is authoritative
   * about what is on screen (ADR 0003), so the tap becomes a navigation to where that tab was,
   * and the activation that follows is what fills the tab in.
   */
  private onNativeSelect(selection: TabSelection | undefined): void {
    if (!selection) return;
    this.provenance = selection.provenance;

    const entry = this.readTabs().find(
      (tab) => screenKeyOf(tab.key) === selection.selectedScreenKey,
    );
    if (!entry || entry === this.selected) return;

    // Returning to a tab returns to the url it was last on, which is the whole point of keeping
    // it mounted. A tab never visited starts at its own path.
    // A navigation that fails is reported, unless activation reported it already: a page that
    // does not load, caught here, would otherwise leave nothing but a tab that will not open.
    void this.router?.navigateByUrl(entry.url || this.pathOf(entry)).then(
      (arrived) => this.revertUnless(arrived),
      (error: unknown) => {
        if (error === null || typeof error !== 'object' || !this.reported.has(error)) {
          this.errors.handleError(error);
        }
        this.revertUnless(false);
      },
    );
  }

  /**
   * Native switched tab before the router agreed to. When a guard refuses, or the navigation
   * fails, the router stays where it was and so must the bar, or it shows a tab nobody is on.
   * Not while another navigation is under way: that one superseded this, and its own activation
   * selects the tab it lands on.
   */
  private revertUnless(arrived: boolean): void {
    if (arrived || !this.selected || this.router?.getCurrentNavigation()) return;
    this.request(this.selected);
    // A failed navigation ends in a promise callback, which schedules no change detection, and a
    // prop reaches native only with the commit at the end of a pass. Without one the bar stayed
    // on the tab that failed until something else happened to render.
    this.changeDetector.markForCheck();
  }

  /** A tab's own url, from the outlet's route down. */
  private pathOf(entry: TabEntry): string {
    const parent = this.route.snapshot.pathFromRoot
      .flatMap((snapshot) => snapshot.url.map((segment) => segment.path))
      .join('/');
    return `/${[parent, entry.key].filter(Boolean).join('/')}`;
  }

  /**
   * As the stack outlet's: the route, the outlet contexts, and whether the tab is showing. And the
   * tab itself, for its stacks to hear when another comes in front.
   */
  private outletInjector(route: ActivatedRoute, entry: TabEntry): Injector {
    const outer = this.injector.get(SCREEN_IN_FRONT);
    const tab: InTab = {
      onLeave: (leave) => (entry.leaving.add(leave), () => entry.leaving.delete(leave)),
    };
    return Injector.create({
      parent: this.injector,
      providers: [
        { provide: SCREEN_IN_FRONT, useValue: computed(() => outer() && entry.inFront()) },
        { provide: IN_TAB, useValue: tab },
        { provide: ActivatedRoute, useValue: route },
        {
          provide: ChildrenOutletContexts,
          useValue: this.parentContexts.getOrCreateContext(this.name).children,
        },
      ],
    });
  }
}
