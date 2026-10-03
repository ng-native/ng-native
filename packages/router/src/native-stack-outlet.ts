/**
 * A `RouterOutlet` that renders a native stack instead of swapping one view for another.
 *
 * The outlet's host element *is* the `RNSScreenStack`, and each activated route's component is
 * created directly on its own `screen` child rather than on a wrapper view inside it (ADR 0004).
 * The screens below the top stay mounted, which is what keeps a pushed-away screen's native
 * state alive: its scroll offset, its text cursor, its keyboard focus.
 *
 * Push and pop are inferred from the calls the router already makes. With a reuse strategy that
 * detaches, navigating forward is `detach()` then `activateWith()`, and navigating back is
 * `detach()` then `attach(ref)` with a ref we handed out earlier. Finding that ref in our own
 * stack is what identifies a pop, so nothing here needs to consult the URL.
 *
 * Note `activityState` is set once, to active, and never lowered. `Screen.tsx` throws on any
 * decrease while `isNativeStack`, because a native stack decides what is visible from the order
 * of its children rather than from a per-screen flag. Toggling that flag is for `ScreenContainer`
 * (tabs), where every screen is mounted at once.
 */
import {
  ApplicationRef,
  Component,
  DestroyRef,
  ElementRef,
  ErrorHandler,
  HostAttributeToken,
  InjectionToken,
  Injector,
  Renderer2,
  afterEveryRender,
  computed,
  createComponent,
  inject,
  signal,
  type ComponentRef,
  type EnvironmentInjector,
  type OnInit,
  type Type,
  type WritableSignal,
} from '@angular/core';
import {
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  PRIMARY_OUTLET,
  Router,
  createUrlTreeFromSnapshot,
  type Data,
  type RouterOutletContract,
} from '@angular/router';
import { Location, PlatformLocation } from '@angular/common';
import { SCREEN_IN_FRONT } from '@ng-native/device';
import { bindRouteInputs } from './bind-route-inputs.ts';
import { NativeBack, isShowing } from './native-back.ts';
import { intentOf, type NativeIntent } from './native-navigation.ts';
import { NativePlatformLocation } from './native-platform-location.ts';
import { markScreenRoute } from './tab-routes.ts';
import { ownHost } from './own-host.ts';
import { HostEngine, type EngineNode } from '@ng-native/fabric';
import type { ScreenPresentation } from './screen-presentation.ts';
import { ActivityState } from './screens.ts';

interface StackEntry {
  route: ActivatedRoute;
  ref: ComponentRef<unknown>;
  /** The `screen` element this entry's component lives inside. */
  screen: unknown;
  /** True while the router is holding this ref for a later `attach`. */
  detached: boolean;
  /** Stops feeding route params into the component's inputs. */
  unbind: () => void;
  /** How the screen was put on screen, for a push from it to follow. */
  presentation?: ScreenPresentation;
  /** The navigation that put this screen on the stack, until that navigation ends. */
  activatedIn?: number;
  /** The navigation that covered this screen, until that navigation ends. */
  detachedIn?: number;
  /** Whether this screen is the one in front, for what it holds: see `SCREEN_IN_FRONT`. */
  inFront: WritableSignal<boolean>;
}

/**
 * The last navigation, per router, whose presentation an outlet has already given a screen.
 *
 * Presenting a route that is a stack of its own activates two outlets in one navigation: the one
 * the route is presented in, and the one inside it that shows the route's first child. Only the
 * first is presented; the second is the first screen of a stack inside a presented screen, and a
 * push inside that stack must see it as a pushed screen, not one to present over.
 */
const presented = new WeakMap<object, number>();

/** What every screen needs to fill the stack, the same five keys RNSScreen itself expects. */
const FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

/** A swipe-back area with no limit on any edge. */
const UNLIMITED_SWIPE = { start: -1, end: -1, top: -1, bottom: -1 } as const;

/**
 * The screen a page lives in, for a stack inside that page. A presented screen with a header is
 * such a stack, and the page that knows whether to refuse a dismissal is a screen inside it, where
 * the screen a swipe down dismisses is this one.
 */
const HOLDING_SCREEN = new InjectionToken<HoldingScreen>('ng-native.router.holding-screen');

interface HoldingScreen {
  readonly screen: unknown;
  /**
   * Told when a stack inside the screen changes what the screen refuses, so the stack the screen
   * is in can pass that on in turn, in the same render: its own look came before this one.
   */
  refusalChanged(): void;
}

/** Whether a screen refuses a native dismissal, as its page bound it. */
const refuses = (screen: unknown): boolean =>
  (screen as Partial<EngineNode> | undefined)?.props?.['preventNativeDismiss'] === true;

/** The native engine's `dispatchEvent`, as Fabric calls it. */
type NativeDispatch = (node: unknown, topLevelType: string, nativeEvent: unknown) => void;

@Component({
  selector: 'native-stack-outlet',
  template: '',
  host: { '[style]': 'fill' },
})
export class NativeStackOutlet implements RouterOutletContract, OnInit {
  /**
   * Named outlets work exactly as on the web: `<native-stack-outlet name="list" />` is filled by
   * routes with `outlet: 'list'`. The default is the primary one. Read once, as the router's own
   * outlet reads it, since an outlet cannot change which contexts it is registered under.
   */
  readonly name = inject(new HostAttributeToken('name'), { optional: true }) ?? PRIMARY_OUTLET;

  readonly supportsBindingToComponentInputs = true;

  private readonly parentContexts = inject(ChildrenOutletContexts);
  private readonly renderer = inject(Renderer2);
  private readonly applicationRef = inject(ApplicationRef);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef);
  private readonly location = inject(Location);
  private readonly history = inject(PlatformLocation);
  /**
   * Only for the intent a navigation carries. Optional so the outlet can be exercised through
   * `RouterOutletContract` directly, which is how its own tests drive it.
   */
  private readonly router = inject(Router, { optional: true });
  /** For a refused back to reach the screen as native's own report would. */
  private readonly engine = inject(HostEngine, { optional: true });

  private readonly errors = inject(ErrorHandler);
  /** The screen this stack sits in, when it is a stack inside a page of another. */
  private readonly holder = inject(HOLDING_SCREEN, { optional: true });
  /** What the holder's own `preventNativeDismiss` was, while this stack's top screen refuses. */
  private held: { own: unknown } | null = null;

  private readonly entries: StackEntry[] = [];
  /**
   * The screens a replace or a reset supersedes, kept until the navigation that supersedes them
   * succeeds: one that fails leaves the stack as it was.
   */
  private superseded: { entries: StackEntry[]; navigation: number } | null = null;

  protected readonly fill = { flex: 1 };

  constructor() {
    ownHost(this.host.nativeElement);
    // Ours, not a prop of the native stack.
    delete (this.host.nativeElement as { props: Record<string, unknown> }).props['name'];
    this.parentContexts.onChildOutletCreated(this.name, this);

    // Android's back button, and `NativeNavigation.back()`. Declining at the bottom of the stack
    // is deliberate: the outlet this one sits in gets its turn, and when none takes it the
    // platform backgrounds the app, which is what a user expects, rather than the app swallowing
    // the press and appearing stuck.
    //
    // Not yet verified on a device: whether react-native-screens' own Android back handling
    // (`nativeBackButtonDismissalEnabled`) also pops the screen, which would make one press pop
    // twice. If a back press ever skips a screen on Android, look here first.
    const back = inject(NativeBack);
    const unsubscribeBack = back.handle((from) =>
      from === 'button' && this.refusesButton() ? true : this.goBack(),
    );
    const unsubscribeStack = back.addStack({
      showing: () => this.isShowing(),
      popToRoot: () => (this.entries.length > 1 ? this.popToEntry(0) : null),
      popTo: (url) => {
        const index = this.entries.findIndex((entry) => this.urlOf(entry) === url);
        return index !== -1 && index < this.entries.length - 1 ? this.popToEntry(index) : null;
      },
    });
    // Optional for the same reason as the router: the outlet's own tests stand one in without it.
    const navigations = this.router?.events?.subscribe((event) => {
      if (event instanceof NavigationEnd) this.settle(event.id);
      else if (event instanceof NavigationError) this.rollBack(event.id);
    });

    const unhold = this.holder ? this.holdRefusals(this.holder) : undefined;

    inject(DestroyRef).onDestroy(() => {
      unhold?.();
      unsubscribeBack();
      unsubscribeStack();
      navigations?.unsubscribe();
      for (const entry of this.entries) {
        entry.unbind();
        entry.ref.destroy();
      }
      this.entries.length = 0;
      this.parentContexts.onChildOutletDestroyed(this.name);
    });
  }

  /** The screens currently in the stack, oldest first. Exposed for tests. */
  get depth(): number {
    return this.entries.length;
  }

  ngOnInit(): void {
    this.activateCurrentRoute();
  }

  /**
   * The route the router is already on, for an outlet created after the navigation that reached
   * it: one held behind a condition until a session or a database is ready. The router activates
   * an outlet as a navigation ends, and that one ended with no outlet to activate, so the outlet
   * takes the route from its context as it arrives, as Angular's own `RouterOutlet` does.
   */
  private activateCurrentRoute(): void {
    if (this.isActivated) return;
    const context = this.parentContexts.getContext(this.name);
    if (!context?.route) return;
    if (context.attachRef) this.attach(context.attachRef, context.route);
    else this.activateWith(context.route, context.injector);
  }

  // --- RouterOutletContract ----------------------------------------------

  get isActivated(): boolean {
    return this.top !== undefined && !this.top.detached;
  }

  get component(): Object | null {
    return this.top && !this.top.detached ? (this.top.ref.instance as Object) : null;
  }

  get activatedRoute(): ActivatedRoute | null {
    return this.top && !this.top.detached ? this.top.route : null;
  }

  get activatedRouteData(): Data {
    return this.activatedRoute?.snapshot.data ?? {};
  }

  /** The input binder reads this to bind route params to component inputs. */
  get activatedComponentRef(): ComponentRef<unknown> | null {
    return this.top?.ref ?? null;
  }

  activateWith(route: ActivatedRoute, environmentInjector: EnvironmentInjector): void {
    const component = (route.component ?? route.snapshot.component) as Type<unknown> | null;
    if (!component) {
      throw new Error('[angular-native] route has no component to activate');
    }
    // Whatever a stack shows is a screen, children or not, and must survive being covered.
    if (route.snapshot.routeConfig) markScreenRoute(route.snapshot.routeConfig);

    // What kind of navigation this is, over and above which route it lands on: a replace
    // supersedes the screen below rather than stacking on it, and a reset empties the stack.
    // Everything else leaves the screens below mounted, so their native state survives the trip.
    const intent = this.currentIntent();
    const navigation = this.navigationId();
    const presentation = this.presentationFor(intent);
    //
    // The screen is the page's host element, so its props are set before the component exists
    // and the component's own host bindings land on top of them. Style bindings merge key by
    // key, so a page styling itself keeps the absolute fill the stack lays out with - except for
    // `position` and the four insets, which a page naming them writes over outright rather than
    // merging into. Those five are re-asserted below, after the page's own change detection has
    // run, so the outlet's positioning always wins whatever a page's host style says.
    const screen = this.createScreen(presentation);
    const inFront = signal(true);
    const { ref, unbind } = this.createPage(component, route, environmentInjector, screen, inFront);
    // The page's own host style, including any `position` or inset it declared, has now landed
    // on the screen: put the stack's fill back over it. Per-key, through `setStyle`, so whatever
    // else the page's style set - a background colour, say - still merges and stays.
    this.fillScreen(screen);

    if (intent?.stack === 'reset') this.supersede(this.entries.slice(), navigation);
    else if (intent?.stack === 'replace' && this.top) this.supersede([this.top], navigation);
    this.entries.push({
      route,
      ref,
      screen,
      detached: false,
      unbind,
      presentation,
      activatedIn: navigation,
      inFront,
    });
  }

  /**
   * The page's component, created on its screen and rendered once.
   *
   * A page that throws on that first render fails the navigation, and nothing of it may stay: a
   * half-made screen left on the stack is one the router does not know about, with a component
   * still running on it. So its component is destroyed, its screen taken off the stack, the
   * screen it was pushed from given back its change detection, and the error handed to the
   * app's `ErrorHandler` before the router fails the navigation with it.
   */
  private createPage(
    component: Type<unknown>,
    route: ActivatedRoute,
    environmentInjector: EnvironmentInjector,
    screen: unknown,
    inFront: WritableSignal<boolean>,
  ): { ref: ComponentRef<unknown>; unbind: () => void } {
    let ref: ComponentRef<unknown> | undefined;
    let unbind: (() => void) | undefined;
    try {
      ref = createComponent(component, {
        environmentInjector,
        elementInjector: this.outletInjector(route, inFront, screen),
        hostElement: screen as Element,
      });
      this.applicationRef.attachView(ref.hostView);
      // Route params onto inputs before the first change detection, not after: a required input
      // read in the template throws NG0950 if it is still unset when the page first renders.
      unbind = this.bindInputs(ref, route);
      // Before anything can commit. Creating the page's nodes dirties the tree, which schedules a
      // commit of its own - and that commit would capture the page with its elements created and
      // its bindings not yet applied. On iOS the props catch up a frame later and nobody sees it;
      // on Android the flattening decision is made from the props a view is created with, so a
      // content wrapper that arrives without its `collapsable: false` is flattened for good and
      // its children end up parented to a scroll view that allows exactly one.
      ref.changeDetectorRef.detectChanges();
      return { ref, unbind };
    } catch (error) {
      unbind?.();
      ref?.destroy();
      this.removeScreen(screen);
      this.uncover();
      this.errors.handleError(error);
      throw error;
    }
  }

  deactivate(): void {
    const entry = this.entries.pop();
    if (!entry) return;
    this.drop(entry);
  }

  /**
   * Hand the live `ComponentRef` back to the router without destroying it. The screen stays
   * mounted, so the component keeps running and its native views keep their state.
   */
  detach(): ComponentRef<unknown> {
    const entry = this.top;
    if (!entry) throw new Error('[angular-native] outlet is not activated, nothing to detach');
    entry.detached = true;
    entry.detachedIn = this.navigationId();
    entry.inFront.set(false);
    // `ChangeDetectorRef.detach`, not `ApplicationRef.detachView`. The latter calls
    // `renderDetachView` and pulls the view's nodes out of the tree, which is exactly what we
    // are trying to avoid: the screen would vanish from the stack the moment we pushed past it.
    // This stops change detection for an off-screen screen while leaving it mounted.
    entry.ref.hostView.detach();
    return entry.ref;
  }

  /**
   * Re-attach a previously detached ref. If we still hold it, everything stacked above it is a
   * screen the user has navigated back past, so those are destroyed: that is the pop.
   */
  attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void {
    const index = this.entries.findIndex((entry) => entry.ref === ref);

    if (index === -1) {
      // Not ours: the router is restoring a ref detached by a different outlet instance. Its
      // host element is already a screen, complete with the `dismissed` listener that outlet
      // registered, so it is re-parented rather than rebuilt.
      const screen = ref.location.nativeElement;
      this.renderer.appendChild(this.host.nativeElement, screen);
      this.entries.push({
        route,
        ref,
        screen,
        detached: false,
        unbind: this.bindInputs(ref, route),
        // What it was given is its first outlet's; this one has no say over that screen's.
        inFront: signal(true),
      });
      this.applicationRef.attachView(ref.hostView);
    } else {
      for (const above of this.entries.splice(index + 1)) this.drop(above);
      const entry = this.entries[index]!;
      entry.detached = false;
      entry.inFront.set(true);
      entry.route = route;
      // The route object is new even when the url is not, so the inputs follow the new one.
      entry.unbind();
      entry.unbind = this.bindInputs(ref, route);
    }

    // Resume change detection for the screen the user is coming back to.
    ref.hostView.reattach();
  }

  // --- native stack -------------------------------------------------------

  /**
   * Route params onto the page's inputs, but only in an app that asked for it with
   * `withComponentInputBinding()`, which is the only time Angular's own outlet binds them. Read
   * per screen rather than once, for a test that stands the router in.
   */
  private bindInputs(ref: ComponentRef<unknown>, route: ActivatedRoute): () => void {
    return this.router?.componentInputBindingEnabled ? bindRouteInputs(ref, route) : () => {};
  }

  private get top(): StackEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * What the navigation asked for, if it asked for anything. Read here rather than remembered,
   * because the router is mid-navigation for exactly as long as an activation takes.
   */
  private currentIntent(): NativeIntent | null {
    return intentOf(this.router?.getCurrentNavigation()?.extras.state);
  }

  /**
   * How the screen a navigation activates is put on screen.
   *
   * A push on top of a presented screen is presented the same way. `RNSScreenStack` pushes a push
   * screen that follows a modal onto the navigation controller under the modal, so the router
   * would be on the new route while the modal stayed in front, and the modal's own way out would
   * first pop a screen nobody could see. A presentation the navigation names itself wins, and a
   * reset starts a stack with nothing to follow. A presented screen that is a stack of its own is
   * where a push to one of its children goes instead, inside it.
   */
  private presentationFor(intent: NativeIntent | null): ScreenPresentation | undefined {
    const own = this.claimPresentation(intent);
    const covering = this.top?.presentation?.stackPresentation;
    if (intent?.stack === 'reset' || !covering || covering === 'push' || own?.stackPresentation) {
      return own;
    }
    return { ...own, stackPresentation: covering };
  }

  /** The navigation's own presentation, unless an outlet further out already presented it. */
  private claimPresentation(intent: NativeIntent | null): ScreenPresentation | undefined {
    if (!intent?.presentation) return undefined;
    const id = this.router?.getCurrentNavigation()?.id;
    if (id === undefined) return intent.presentation;
    if (presented.get(this.router!) === id) return undefined;
    presented.set(this.router!, id);
    return intent.presentation;
  }

  /** Take a screen out for good: its bindings, its component, and its native view. */
  private drop(entry: StackEntry): void {
    entry.unbind();
    entry.ref.destroy();
    this.removeScreen(entry.screen);
  }

  /** Take one entry out of the stack, wherever it is, and drop it. */
  private remove(entry: StackEntry): void {
    const index = this.entries.indexOf(entry);
    if (index === -1) return;
    this.entries.splice(index, 1);
    this.drop(entry);
  }

  // --- a navigation's outcome ----------------------------------------------

  /** The id of the navigation in progress, when there is a router to say. */
  private navigationId(): number | undefined {
    return this.router?.getCurrentNavigation()?.id;
  }

  /**
   * Take out the screens a replace or a reset supersedes once its navigation has succeeded, or
   * at once when there is no navigation to wait for. A replaced screen has already been detached
   * by the router, and with `replaceUrl` its history entry is gone too, so nothing will attach it
   * again; the reuse strategy notices the ref is destroyed and drops its handle.
   */
  private supersede(entries: StackEntry[], navigation: number | undefined): void {
    if (navigation === undefined) {
      for (const entry of entries) this.remove(entry);
      return;
    }
    this.superseded = { entries, navigation };
  }

  /** A navigation succeeded: what it superseded goes, and what it did is no longer undoable. */
  private settle(navigation: number): void {
    if (this.superseded?.navigation === navigation) {
      for (const entry of this.superseded.entries) this.remove(entry);
      this.superseded = null;
    }
    for (const entry of this.entries) {
      if (entry.activatedIn === navigation) entry.activatedIn = undefined;
      if (entry.detachedIn === navigation) entry.detachedIn = undefined;
    }
  }

  /**
   * A navigation failed, so the router is back where it started: undo what it did here too.
   *
   * The screen that threw has already gone (`createPage`), but a screen this outlet activated for
   * the same navigation has not when the one that threw is further in, the first screen of a
   * stack inside it. That one goes, with everything in it, and the screen it covered carries on.
   */
  private rollBack(navigation: number): void {
    if (this.superseded?.navigation === navigation) this.superseded = null;
    for (const entry of this.entries.filter((candidate) => candidate.activatedIn === navigation)) {
      this.remove(entry);
    }
    this.uncover(navigation);
  }

  /**
   * Give the top screen back its change detection when the router covered it for a navigation
   * that is not going to happen: the one given, or the one in progress.
   */
  private uncover(navigation = this.navigationId()): void {
    const top = this.top;
    if (!top?.detached || top.detachedIn !== navigation) return;
    top.detached = false;
    top.detachedIn = undefined;
    top.inFront.set(true);
    top.ref.hostView.reattach();
  }

  /**
   * `position: absolute` and the four insets, through `setStyle` rather than one `setProperty`
   * so each key merges into whatever style is already on the screen instead of replacing it -
   * the same merge a page's own host style gets, just asserted last so the stack's layout wins.
   */
  private fillScreen(screen: unknown): void {
    for (const [key, value] of Object.entries(FILL)) {
      this.renderer.setStyle(screen as Element, key, value);
    }
  }

  private createScreen(presentation?: ScreenPresentation): unknown {
    const screen = ownHost(this.renderer.createElement('screen'));
    this.fillScreen(screen);
    // Set once and never lowered: see the note at the top of this file.
    this.renderer.setProperty(screen, 'activityState', ActivityState.Active);
    // A swipe-back or an Android back button pops the screen natively and only then tells JS.
    // Without this the native stack and the router disagree from that moment on: the screen is
    // gone but the URL still points at it, so the next navigation starts from the wrong place.
    this.renderer.listen(
      screen,
      'dismissed',
      (event: { nativeEvent?: { dismissCount?: number } }) =>
        this.onNativeDismiss(event?.nativeEvent?.dismissCount ?? 1),
    );
    // Every key is a prop `RNSScreen` already declares, spelled the way the codegen spec spells
    // it, so this forwards rather than translates. Set before the screen joins the stack: the
    // native side reads the presentation as it mounts.
    for (const [prop, value] of Object.entries(presentation ?? {})) {
      if (value !== undefined) this.renderer.setProperty(screen, prop, value);
    }
    // Except this one, which is a struct with no default: an edge left out is 0 natively, and
    // `RNSScreenStack` refuses a swipe-back that starts beyond 0 points. -1 is no limit, which is
    // what `Screen.tsx` sends for every edge not given.
    this.renderer.setProperty(screen, 'gestureResponseDistance', {
      ...UNLIMITED_SWIPE,
      ...presentation?.gestureResponseDistance,
    });

    this.renderer.appendChild(this.host.nativeElement, screen);
    return screen;
  }

  /**
   * Follow a pop the user already made. `historyGo`, not `back()`, because iOS coalesces a long
   * swipe into a single event with a count.
   *
   * Only ever fires for a native dismissal: verified on device that a pop this outlet drives
   * itself emits `willAppear`/`appear` for the screen below but no `dismissed`, so there is no
   * double-pop to guard against.
   *
   * The gesture itself is unverified by tooling: idb cannot synthesise a `UIScreenEdgePan` that
   * UIKit accepts, so this path was reasoned from the events rather than driven end to end.
   */
  private onNativeDismiss(count: number): void {
    this.popBy(Math.max(1, count));
  }

  /**
   * A back, from the button or `NativeNavigation`: pop the top screen, as long as there is one
   * below it and this stack is the one the user is looking at. A stack in a tab behind, or under
   * a screen pushed over the tab bar, is still subscribed, and the newest one would otherwise
   * answer for the stack in front.
   */
  /**
   * Android's Back button is the platform's own dismissal there, and react-native-screens leaves
   * it to JS: its Android screen ignores `preventNativeDismiss`. So a top screen that sets it
   * refuses the press here, as iOS refuses a swipe, and hears `nativeDismissCancelled` the same
   * way, through the engine, as if native had sent it.
   */
  private refusesButton(): boolean {
    if (this.entries.length < 2 || !this.isShowing()) return false;
    const screen = this.top!.screen as EngineNode;
    if (screen.props['preventNativeDismiss'] !== true) return false;
    // The native engine's own entry point for an event, the one Fabric calls. Not on
    // `HostEngine`, because only a native host has a screen to refuse with.
    const native = this.engine as { dispatchEvent?: NativeDispatch } | null;
    native?.dispatchEvent?.(screen, 'topNativeDismissCancelled', { dismissCount: 1 });
    return true;
  }

  /**
   * Passes the top screen's refusal to the screen this stack sits in, and that screen's report of
   * an attempt back to the top screen: the swipe that dismisses a presented stack is on the
   * screen holding it, which the page inside cannot bind.
   *
   * Read after every render, since the refusal is a host binding of whatever page is on top.
   */
  private holdRefusals(holder: HoldingScreen): () => void {
    const render = afterEveryRender(() => this.holdRefusal(holder));
    const unlisten = this.renderer.listen(
      holder.screen,
      'nativeDismissCancelled',
      (event: { nativeEvent?: unknown }) => {
        // The stack can have lost its last screen with the refusal not yet released.
        const top = this.top;
        if (!this.held || !top) return;
        const native = this.engine as { dispatchEvent?: NativeDispatch } | null;
        const report = event?.nativeEvent ?? { dismissCount: 1 };
        native?.dispatchEvent?.(top.screen, 'topNativeDismissCancelled', report);
      },
    );
    return () => {
      render.destroy();
      unlisten();
      this.release(holder);
    };
  }

  private holdRefusal(holder: HoldingScreen): void {
    // A stack in a tab behind is inside the same screen, and has no say in it.
    if (!refuses(this.top?.screen) || !this.isShowing()) return this.release(holder);
    if (refuses(holder.screen)) return;
    // ponytail: the holder's own binding is read when the top screen starts refusing. One that
    // turns true while it does is put back as it was then; bind the refusal in one of the two.
    this.held = { own: (holder.screen as EngineNode).props?.['preventNativeDismiss'] };
    this.renderer.setProperty(holder.screen, 'preventNativeDismiss', true);
    holder.refusalChanged();
  }

  /** The holder's own answer again, once the top screen no longer refuses. */
  private release(holder: HoldingScreen): void {
    if (!this.held) return;
    this.renderer.setProperty(holder.screen, 'preventNativeDismiss', this.held.own ?? false);
    this.held = null;
    holder.refusalChanged();
  }

  private goBack(): boolean {
    if (this.entries.length < 2 || !this.isShowing()) return false;
    this.popBy(1);
    return true;
  }

  /** Whether the top screen is part of what the router shows now. Assumed without a router. */
  private isShowing(): boolean {
    if (!this.router) return true;
    return this.isActivated && isShowing(this.router, this.top!.route);
  }

  /**
   * Take the router to the screen `steps` below the top, whether native already popped it or it
   * is about to be popped because the router arrives there.
   */
  private popBy(steps: number): void {
    const below = this.entries[this.entries.length - 1 - steps];
    const url = below && this.router ? this.urlOf(below) : null;
    // Usually the entry that far back is the screen the pop revealed, and going back through
    // history keeps it tidy. Not always: a stack inside a tab shares history with the other tabs,
    // so after a trip to one and back the entry behind the top screen is that other tab, and
    // going back would switch tab rather than pop. Then the router is sent to the revealed
    // screen instead, replacing the entry of the one that is gone.
    const behind = this.historyUrl(-steps);
    if (!url || behind === undefined || behind === url) {
      this.location.historyGo(-steps);
      return;
    }
    void this.router!.navigateByUrl(url, { replaceUrl: true });
  }

  /**
   * Take the router down to the screen at `index`, popping every screen above it together.
   * Through history when the entries behind are these screens, so going back from there keeps
   * working one screen at a time; otherwise by a navigation to it that replaces the entry, as
   * `popBy` does when a tab's history interleaves.
   */
  private popToEntry(index: number): Promise<boolean> {
    const url = this.urlOf(this.entries[index]!);
    const steps = this.entries.length - 1 - index;
    if (this.historyUrl(-steps) === url) {
      const arrived = this.nextNavigation();
      this.location.historyGo(-steps);
      return arrived;
    }
    return this.router!.navigateByUrl(url, { replaceUrl: true });
  }

  /** Whether the navigation that happens next succeeds. */
  private nextNavigation(): Promise<boolean> {
    return new Promise((resolve) => {
      const events = this.router!.events.subscribe((event) => {
        if (event instanceof NavigationEnd) resolve(true);
        else if (event instanceof NavigationError || event instanceof NavigationCancel) {
          resolve(false);
        } else return;
        events.unsubscribe();
      });
    });
  }

  /** The url a screen was showing when it was covered, rebuilt from its own route snapshot. */
  private urlOf(entry: StackEntry): string {
    const snapshot = entry.route.snapshot;
    const tree = createUrlTreeFromSnapshot(snapshot, [], snapshot.queryParams, snapshot.fragment);
    return this.router!.serializeUrl(tree);
  }

  /**
   * The url of the history entry `offset` away, normalised the way the router writes it: null past
   * the start of history, and undefined when the history is not ours to read, so the pop has to go
   * through it blind.
   */
  private historyUrl(offset: number): string | null | undefined {
    if (!(this.history instanceof NativePlatformLocation)) return undefined;
    const url = this.history.ɵurlAt(offset);
    return url === null ? null : this.router!.serializeUrl(this.router!.parseUrl(url));
  }

  private removeScreen(screen: unknown): void {
    this.renderer.removeChild(this.host.nativeElement, screen);
  }

  /**
   * What a page is created with: its route, its screen, the outlet contexts its own outlets
   * register in, and whether its screen is in front - which is this screen's own say and, for a stack inside a
   * screen of another, that screen's too.
   */
  private outletInjector(
    route: ActivatedRoute,
    inFront: WritableSignal<boolean>,
    screen: unknown,
  ): Injector {
    const outer = this.injector.get(SCREEN_IN_FRONT);
    return Injector.create({
      parent: this.injector,
      providers: [
        { provide: SCREEN_IN_FRONT, useValue: computed(() => outer() && inFront()) },
        {
          provide: HOLDING_SCREEN,
          useValue: {
            screen,
            refusalChanged: () => this.holder && this.holdRefusal(this.holder),
          } satisfies HoldingScreen,
        },
        { provide: ActivatedRoute, useValue: route },
        {
          provide: ChildrenOutletContexts,
          useValue: this.parentContexts.getOrCreateContext(this.name).children,
        },
      ],
    });
  }
}
